// GET /api/fab/ready-queue
// Returns flow_jobs rows that don't yet have a fab_jobs entry, enriched with
// Hub job-state (ss_drawings_issued + materials_received).
// Calls Hub only — never reads detailing_handoffs or purchasing tables directly.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { requireFabUser } from '@/lib/get-fab-user'
import { getJobState, getJobStateByQuoteNumber } from '@/lib/hub'
import type { ReadyQueueItem } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await requireFabUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getSupabaseAdmin()

  // Jobs already in progress in fab — exclude from queue
  const { data: activeFabJobs } = await admin
    .from('fab_jobs')
    .select('quote_number')
  const activeFabQuotes = new Set((activeFabJobs ?? []).map((j: { quote_number: string }) => j.quote_number))

  // All jobs from the shared jobs table
  const { data: allJobs, error } = await admin
    .from('jobs')
    .select('id, quote_number, name, client, location')
    .not('is_test', 'is', true) // test jobs never offered to Start Fabrication
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Filter to jobs not yet in fab, then enrich with Hub state
  const candidates = (allJobs ?? []).filter(
    (j: { quote_number: string }) => !activeFabQuotes.has(j.quote_number)
  )

  // Check Hub for each candidate (in batches of 10 to avoid overwhelming Hub)
  const results: ReadyQueueItem[] = []

  for (const job of candidates.slice(0, 50)) {
    const hubRes = await getJobStateByQuoteNumber(job.quote_number)
    const hubState = hubRes.ok ? hubRes.state : null

    // The real manufacturing trigger is the deliberate "Release to Factory"
    // (ss_release). Prefer it; fall back to ready_to_ship when the Hub hasn't
    // published a release yet, so the queue keeps working before the Hub deploy
    // and auto-upgrades to release-gated the moment ss_release appears.
    const ssRelease = hubState?.ss_release ?? null
    const ssReleased = ssRelease != null
    const ssDrawingsIssued = ssReleased || (hubState?.ready_to_ship ?? false)
    const materialsReceived = hubState?.materials_received ?? false

    // Only include if released (or, pre-release, drawings issued) — else not relevant to fab
    if (!ssDrawingsIssued && !materialsReceived) continue

    results.push({
      quote_number: job.quote_number,
      hubspot_deal_id: hubState?.deal_id ?? null,
      name: job.name,
      client: job.client ?? null,
      on_site_date: hubState?.on_site_date ?? null,
      ss_drawings_issued: ssDrawingsIssued,
      materials_received: materialsReceived,
      ss_released: ssReleased,
      release_version: ssRelease?.version ?? null,
      ready: ssDrawingsIssued && materialsReceived,
    })
  }

  // Sort: fully ready first, then drawings-only
  results.sort((a, b) => Number(b.ready) - Number(a.ready))

  return NextResponse.json({ items: results })
}
