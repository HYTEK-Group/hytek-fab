// POST /api/fab/jobs/[id]/qc — bulk QC pass or fail on a list of marks.
// pass: status -> qc_passed, contractor_package_id cleared, QC event logged.
// fail: status -> not_started, rework_count++, rework_note set, package cleared,
//       QC event logged (defect_note required, rework_type optional).
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getSupervisorCaller } from '@/lib/fab-auth'
import { computeAndUpsertProgress } from '@/lib/fab-progress'
import type { ReworkType } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const { id } = await params
  const body = (await req.json()) as {
    mark_ids?: string[]
    result?: 'pass' | 'fail'
    defect_note?: string
    rework_type?: ReworkType
  }
  if (!body.mark_ids?.length || (body.result !== 'pass' && body.result !== 'fail')) {
    return NextResponse.json({ error: 'mark_ids[] and result (pass|fail) required' }, { status: 400 })
  }
  if (body.result === 'fail' && !body.defect_note?.trim()) {
    return NextResponse.json({ error: 'defect_note required on fail' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const now = new Date().toISOString()

  // Fetch current rows (to increment rework_count per-row on fail).
  const { data: marks, error: fetchErr } = await admin
    .from('fab_marks')
    .select('id, rework_count')
    .eq('fab_job_id', id)
    .in('id', body.mark_ids)
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!marks?.length) return NextResponse.json({ error: 'No matching marks' }, { status: 404 })

  // Apply the mark transition. Per-row update so rework_count increments correctly.
  for (const m of marks) {
    if (body.result === 'pass') {
      await admin.from('fab_marks')
        .update({ status: 'qc_passed', contractor_package_id: null, updated_at: now })
        .eq('id', m.id)
    } else {
      await admin.from('fab_marks')
        .update({
          status: 'not_started',
          contractor_package_id: null,
          rework_count: (m.rework_count ?? 0) + 1,
          rework_note: body.defect_note!.trim(),
          updated_at: now,
        })
        .eq('id', m.id)
    }
  }

  // Log one QC event per mark.
  const events = marks.map(m => ({
    fab_job_id: id,
    mark_id: m.id,
    inspected_by: caller.name,
    result: body.result!,
    defect_note: body.result === 'fail' ? body.defect_note!.trim() : null,
    rework_type: body.result === 'fail' ? (body.rework_type ?? null) : null,
  }))
  const { error: evErr } = await admin.from('fab_qc_events').insert(events)
  if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 })

  await computeAndUpsertProgress(id)
  return NextResponse.json({ ok: true, count: marks.length })
}
