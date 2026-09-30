// GET /api/fab/waiting-tasks — Hub variation/rework tasks that reached fab
// before fabrication started on their job (fab_tasks with a job number and no
// fab_job_id — sql/migrations/017). Shown on the Ready page so they are never
// invisible; POST /api/fab/jobs attaches them when the job is started.
//
// Also the quiet retry for work_item_done: any closed variation/rework task the
// Hub has not yet taken is sent again here (src/lib/work-item-done.ts).

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getUserCaller } from '@/lib/fab-auth'
import { flushOwedWorkItems } from '@/lib/work-item-done'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const caller = await getUserCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = getSupabaseAdmin()

  await flushOwedWorkItems(admin)

  const { data, error } = await admin
    .from('fab_tasks')
    .select('id, quote_number, description, assigned_to, status, variation_id, rework_id, created_at')
    .is('fab_job_id', null)
    .neq('status', 'done')
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const tasks = (data ?? []) as Array<{ quote_number: string | null } & Record<string, unknown>>

  // Names from the shared jobs table (fab's column-level read). Best-effort:
  // a failed read shows the number alone.
  const quotes = [...new Set(tasks.map(t => t.quote_number).filter((q): q is string => !!q))]
  const nameByQuote = new Map<string, { name: string | null; is_test: boolean | null }>()
  if (quotes.length > 0) {
    const { data: jobs } = await admin.from('jobs').select('quote_number, name, is_test').in('quote_number', quotes)
    for (const j of (jobs ?? []) as { quote_number: string; name: string | null; is_test: boolean | null }[]) {
      nameByQuote.set(j.quote_number, { name: j.name, is_test: j.is_test })
    }
  }

  return NextResponse.json({
    tasks: tasks
      .filter(t => !(t.quote_number && nameByQuote.get(t.quote_number)?.is_test === true))
      .map(t => ({ ...t, job_name: t.quote_number ? nameByQuote.get(t.quote_number)?.name ?? null : null })),
  })
}
