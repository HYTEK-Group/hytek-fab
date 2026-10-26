// GET  /api/fab/jobs — list all active fab jobs with task/time summaries
// POST /api/fab/jobs — start fabrication on a job (creates fab_jobs row)

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { resolveJobRef } from '@/lib/job-lookup'
import { getSupervisorCaller, getUserCaller } from '@/lib/fab-auth'
import { FAB_JOB_SUMMARY_SELECT, summariseFabJob } from '@/lib/fab-job-summary'
import { flushOwedWorkItems } from '@/lib/work-item-done'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const caller = await getUserCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getSupabaseAdmin()
  // Quiet retry of any work_item_done the Hub has not taken yet (fab has no
  // cron; this list is the page fab opens most). Cheap when nothing is owed.
  await flushOwedWorkItems(admin)
  const { data, error } = await admin
    .from('fab_jobs')
    .select(FAB_JOB_SUMMARY_SELECT)
    .not('is_test', 'is', true)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Summarise nested arrays into counts (lib/fab-job-summary.ts — shared with GET /api/fab/jobs/[id]).
  const today = new Date().toISOString().slice(0, 10)
  const jobs = (data ?? []).map((j: Record<string, unknown>) => summariseFabJob(j, today))

  return NextResponse.json({ jobs })
}

export async function POST(req: NextRequest) {
  // getSupervisorCaller, NOT requireFabSupervisor: the latter accepts only a
  // Supabase JWT, and the office-server ingest bridge authenticates with a kiosk
  // token like every other route it calls (/import-assembly, /import-bom). With
  // requireFabSupervisor here the bridge could not create a job at all — it got
  // 403 and fell back to writing fab_jobs with the service-role key, which is
  // exactly the door this checkpoint closes.
  const user = await getSupervisorCaller(req)
  if (!user) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })

  const body = (await req.json()) as {
    quote_number: string
    hubspot_deal_id?: string | null
    name: string
    client?: string | null
    on_site_date?: string | null
    cc_level?: string | null
  }

  if (!body.quote_number?.trim()) {
    return NextResponse.json({ error: 'quote_number required' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()

  // ONLY THE HUB ISSUES JOB NUMBERS. This route used to insert a fab_jobs row
  // from whatever the body carried — so a typo, or the ingest bridge handing it
  // a whole folder name, created a job that existed in exactly one database and
  // reconciled with nothing. An unknown number is refused; a legacy HG or
  // 7-digit reference is resolved to the canonical number first.
  const resolved = await resolveJobRef(admin, body.quote_number)
  if (!resolved.ok) {
    return NextResponse.json(
      {
        error: resolved.reason === 'test'
          ? `${body.quote_number.trim()} is a test job — fab never fabricates one`
          : `Unknown job number "${body.quote_number.trim()}" — jobs are created in the Hub first`,
        reason: resolved.reason,
      },
      { status: 422 },
    )
  }
  const shared = resolved.job

  // Idempotent: if already exists, return existing. Keyed on the CANONICAL
  // number, so starting the same job twice under two of its names is one job.
  const { data: existing } = await admin
    .from('fab_jobs')
    .select('*')
    .eq('quote_number', shared.quote_number)
    .maybeSingle()

  if (existing) {
    await consumeFromQueue(admin, shared.quote_number)
    await attachWaitingTasks(admin, shared.quote_number, (existing as { id: string }).id)
    return NextResponse.json({ job: existing, created: false, matched_by: resolved.matchedBy })
  }

  const { data, error } = await admin
    .from('fab_jobs')
    .insert({
      // The Hub's values, never the caller's. The name typed into Start
      // Fabrication is ignored: the Hub is the source of a job's name, and two
      // apps disagreeing about what a job is called is how a reconciliation
      // report becomes unreadable.
      quote_number: shared.quote_number,
      hubspot_deal_id: shared.hubspot_deal_id,
      name: shared.name ?? body.name?.trim() ?? shared.quote_number,
      client: shared.client,
      on_site_date: body.on_site_date ?? null,
      cc_level: body.cc_level ?? null,
      status: 'in_progress',
      // permissive by decision 2026-09; strict mode is a Scott switch, not a
      // code default (07-fab.md §7).
      compliance_mode: 'permissive',
      started_by: user.name,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // The job has left the queue. Best-effort on purpose: the fab_jobs row is the
  // fact that matters and it is already written, and GET /api/fab/ready-queue
  // self-heals any row this misses. Failing the Start Fabrication a supervisor
  // just did, because a bookkeeping update did not take, would be the wrong
  // trade every time.
  await consumeFromQueue(admin, shared.quote_number)
  await attachWaitingTasks(admin, shared.quote_number, (data as { id: string }).id)

  return NextResponse.json({ job: data, created: true, matched_by: resolved.matchedBy }, { status: 201 })
}

/** Stamp `consumed_at` so the job stops being offered. Never throws. */
async function consumeFromQueue(admin: ReturnType<typeof getSupabaseAdmin>, quoteNumber: string) {
  const { error } = await admin
    .from('fab_ready_queue')
    .update({ consumed_at: new Date().toISOString() })
    .eq('quote_number', quoteNumber)
    .is('consumed_at', null)
  if (error) console.warn(`[fab/jobs] could not stamp fab_ready_queue.consumed_at for ${quoteNumber}: ${error.message}`)
}

/** Variation/rework tasks the Hub raised before fabrication started wait with
 *  the job number and no fab_job_id (sql/migrations/017). Starting the job
 *  brings them onto it. Best-effort, never throws: a miss is still on the
 *  waiting list and is picked up the next time this job is started/opened. */
async function attachWaitingTasks(admin: ReturnType<typeof getSupabaseAdmin>, quoteNumber: string, fabJobId: string) {
  const { error } = await admin
    .from('fab_tasks')
    .update({ fab_job_id: fabJobId, updated_at: new Date().toISOString() })
    .eq('quote_number', quoteNumber)
    .is('fab_job_id', null)
  if (error) console.warn(`[fab/jobs] could not attach waiting tasks for ${quoteNumber}: ${error.message}`)
}
