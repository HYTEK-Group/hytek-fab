// GET /api/fab/jobs/[id] — ONE fab job with the same summary fields
// GET /api/fab/jobs returns for each job in its list.
//
// The job page used to download the whole list (every job, with every task,
// time entry, mark and package nested) just to show this one job's header.
// Same guard as the list (getUserCaller), same select, same summary
// (lib/fab-job-summary.ts), same test-job exclusion — a test job the list would
// not have shown is a 404 here, and the page stays on "Loading…" exactly as it
// did when the job was missing from the list.
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getUserCaller } from '@/lib/fab-auth'
import { FAB_JOB_SUMMARY_SELECT, summariseFabJob } from '@/lib/fab-job-summary'
import { flushOwedWorkItems } from '@/lib/work-item-done'
import { runAfterResponse } from '@/lib/after-response'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getUserCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const admin = getSupabaseAdmin()
  // Opening a job page used to fetch the list, which retries any owed
  // work_item_done. Keep that retry, but off the request path.
  runAfterResponse('work_item_done flush', () => flushOwedWorkItems(admin))

  const { data, error } = await admin
    .from('fab_jobs')
    .select(FAB_JOB_SUMMARY_SELECT)
    .eq('id', id)
    .not('is_test', 'is', true)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  return NextResponse.json({ job: summariseFabJob(data as Record<string, unknown>, new Date().toISOString().slice(0, 10)) })
}
