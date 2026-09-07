// GET /api/fab/ready-queue
// Returns flow_jobs rows that don't yet have a fab_jobs entry, enriched with
// Hub job-state (ss_drawings_issued + materials_received).
// Calls Hub only — never reads detailing_handoffs or purchasing tables directly.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
// Kiosk tokens too: the ingest bridge asks this route whether a job has been
// released before it starts fabricating it, so it talks to exactly one app.
import { getUserCaller } from '@/lib/fab-auth'
import { getJobStateByQuoteNumber, hubConfigured, HUB_NOT_CONFIGURED } from '@/lib/hub'
import type { ReadyQueueItem } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getUserCaller(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // No Hub credential = no answer, and the screen says so. It used to say
  // "No jobs ready" — indistinguishable from a real empty queue, because
  // src/lib/hub.ts returned a fabricated job-state when the token was unset.
  if (!hubConfigured()) {
    return NextResponse.json({ items: [], note: HUB_NOT_CONFIGURED })
  }

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
  let hubFailures = 0

  for (const job of candidates.slice(0, 50)) {
    const hubRes = await getJobStateByQuoteNumber(job.quote_number)
    if (!hubRes.ok) hubFailures++
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

  // An unanswered Hub is reported, not hidden behind a short list.
  const note = hubFailures > 0
    ? `Hub did not answer for ${hubFailures} job${hubFailures === 1 ? '' : 's'} — this list is incomplete`
    : undefined

  return NextResponse.json({ items: results, ...(note ? { note } : {}) })
}
