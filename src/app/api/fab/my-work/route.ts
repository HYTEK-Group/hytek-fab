// GET /api/fab/my-work — everything assigned to the signed-in worker, across all
// jobs, for the floor "my work" screen. Not-done first, then by on-site date.
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getUserCaller } from '@/lib/fab-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const caller = await getUserCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('fab_marks')
    .select('id, fab_job_id, mark_id, description, section, weight_kg, quantity, status, allotted_minutes, actual_minutes, started_at, finished_at, drawing_page, fab_jobs(quote_number, name, on_site_date)')
    .eq('assigned_to', caller.name)
    .order('mark_id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const items = (data ?? []).map(m => {
    const job = (m as { fab_jobs?: { quote_number?: string; name?: string; on_site_date?: string | null } }).fab_jobs
    return {
      id: m.id,
      fab_job_id: m.fab_job_id,
      mark_id: m.mark_id,
      description: m.description,
      section: m.section,
      weight_kg: m.weight_kg,
      quantity: m.quantity,
      status: m.status,
      allotted_minutes: m.allotted_minutes,
      actual_minutes: m.actual_minutes,
      started_at: m.started_at,
      finished_at: m.finished_at,
      quote_number: job?.quote_number ?? null,
      job_name: job?.name ?? null,
      on_site_date: job?.on_site_date ?? null,
    }
  })

  const rank = (s: string) => (s === 'done' || s === 'qc_passed' ? 2 : s === 'in_progress' ? 0 : 1)
  items.sort((a, b) =>
    rank(a.status) - rank(b.status) ||
    (a.on_site_date ?? '9999').localeCompare(b.on_site_date ?? '9999') ||
    a.mark_id.localeCompare(b.mark_id),
  )

  const total = items.length
  const done = items.filter(i => i.status === 'done' || i.status === 'qc_passed').length
  const tonnesTotal = items.reduce((s, i) => s + Math.max(0, i.weight_kg ?? 0) * (i.quantity ?? 1), 0) / 1000
  const tonnesDone = items
    .filter(i => i.status === 'done' || i.status === 'qc_passed')
    .reduce((s, i) => s + Math.max(0, i.weight_kg ?? 0) * (i.quantity ?? 1), 0) / 1000

  return NextResponse.json({
    worker: caller.name,
    items,
    summary: {
      total, done,
      tonnes_total: Math.round(tonnesTotal * 100) / 100,
      tonnes_done: Math.round(tonnesDone * 100) / 100,
    },
  })
}
