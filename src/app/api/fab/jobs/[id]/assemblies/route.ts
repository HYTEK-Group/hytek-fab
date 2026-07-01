// GET /api/fab/jobs/[id]/assemblies — the supervisor's assign view: every
// assembly (mark) for the job, each with a learned time suggestion, plus the
// list of workers to assign to. The assembly is the unit of work.
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getSupervisorCaller } from '@/lib/fab-auth'
import { suggestMinutes, type HistoryMark } from '@/lib/fab-time-suggest'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const { id } = await params
  const admin = getSupabaseAdmin()

  const [{ data: marks, error }, { data: hist }, { data: pins }] = await Promise.all([
    admin.from('fab_marks').select('*').eq('fab_job_id', id).order('mark_id'),
    // learning history: every completed assembly (with a real actual time), all jobs
    admin.from('fab_marks').select('description, section, weight_kg, quantity, actual_minutes')
      .not('actual_minutes', 'is', null),
    admin.from('fab_pins').select('worker_name, role').eq('is_active', true).order('worker_name'),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const history = (hist ?? []) as HistoryMark[]
  const assemblies = (marks ?? []).map(m => {
    const s = suggestMinutes(
      { description: m.description, section: m.section, weight_kg: m.weight_kg, quantity: m.quantity },
      history,
    )
    return { ...m, suggestion: { minutes: s.minutes, basis: s.basis, confidence: s.confidence, samples: s.samples } }
  })

  return NextResponse.json({
    assemblies,
    workers: (pins ?? []).map(p => p.worker_name),
  })
}
