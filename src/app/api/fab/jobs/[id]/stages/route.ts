// GET  /api/fab/jobs/[id]/stages — the delivery-stage plan for a job: each stage
//   with its pieces + per-stage photo completeness + tonnage, plus the pieces
//   not yet in any stage (to assign). READ = any signed-in floor user.
// POST /api/fab/jobs/[id]/stages — create a stage {name, required_on_site_date?,
//   sequence_no?}. Supervisor/admin. stage_ref is a stable cross-app id.
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getUserCaller, getSupervisorCaller } from '@/lib/fab-auth'
import { computeCompleteness, type CompMark } from '@/lib/fab-completeness'
import type { FabDeliveryStage } from '@/lib/types'

export const dynamic = 'force-dynamic'

interface StageMark { id: string; mark_id: string; section: string | null; weight_kg: number | null; quantity: number; status: string; made: boolean }
const tonnesOf = (ms: StageMark[]) =>
  Math.round((ms.reduce((s, m) => s + Math.max(0, m.weight_kg ?? 0) * (m.quantity ?? 1), 0) / 1000) * 1000) / 1000

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getUserCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const admin = getSupabaseAdmin()

  const [{ data: stages }, { data: marks }, { data: photos }] = await Promise.all([
    // Deterministic build order: sequence_no, then created_at + id as stable
    // tiebreaks so two stages that (rarely) share a sequence_no never flip order
    // across reloads.
    admin.from('fab_delivery_stages').select('*').eq('fab_job_id', id)
      .order('sequence_no', { ascending: true }).order('created_at', { ascending: true }).order('id', { ascending: true }),
    admin.from('fab_marks').select('id, mark_id, section, weight_kg, quantity, status, delivery_stage_id').eq('fab_job_id', id).order('mark_id', { ascending: true }),
    admin.from('fab_proof_photos').select('fab_mark_id, stage').eq('fab_job_id', id).eq('stage', 'made'),
  ])

  const madeIds = new Set((photos ?? []).filter(p => p.fab_mark_id).map(p => p.fab_mark_id as string))
  const toMark = (m: { id: string; mark_id: string; section: string | null; weight_kg: number | null; quantity: number; status: string }): StageMark =>
    ({ id: m.id, mark_id: m.mark_id, section: m.section, weight_kg: m.weight_kg, quantity: m.quantity ?? 1, status: m.status, made: madeIds.has(m.id) })

  const byStage = new Map<string, StageMark[]>()
  const unstaged: StageMark[] = []
  for (const m of marks ?? []) {
    const sm = toMark(m)
    if (m.delivery_stage_id) { const a = byStage.get(m.delivery_stage_id) ?? []; a.push(sm); byStage.set(m.delivery_stage_id, a) }
    else unstaged.push(sm)
  }

  const out = (stages ?? []).map(s => {
    const sms = byStage.get(s.id) ?? []
    const compMarks: CompMark[] = sms.map(m => ({ id: m.id, mark_id: m.mark_id }))
    return {
      ...s,
      marks: sms,
      tonnes: tonnesOf(sms),
      completeness: computeCompleteness(compMarks, (photos ?? []).map(p => ({ fab_mark_id: p.fab_mark_id, stage: p.stage }))),
    }
  })

  return NextResponse.json({ stages: out, unstaged, unstaged_tonnes: tonnesOf(unstaged) })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { name?: string; required_on_site_date?: string | null; sequence_no?: number }
  const name = (body.name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const admin = getSupabaseAdmin()
  // Build order is unique per job (DB: uq_fab_stages_job_seq). If the caller pins
  // a sequence_no we honour it once; otherwise we take next-after-max and retry
  // on a unique-violation so two concurrent creates can't land on the same number
  // (read-then-insert is a race the DB index closes).
  const pinned = body.sequence_no !== undefined
  for (let attempt = 0; attempt < 5; attempt++) {
    let seq = body.sequence_no
    if (!pinned) {
      const { data: existing } = await admin.from('fab_delivery_stages').select('sequence_no').eq('fab_job_id', id)
      seq = (existing ?? []).reduce((mx, s) => Math.max(mx, s.sequence_no ?? 0), 0) + 1
    }
    const { data, error } = await admin.from('fab_delivery_stages').insert({
      fab_job_id: id,
      stage_ref: `st_${randomBytes(6).toString('hex')}`,
      name,
      required_on_site_date: body.required_on_site_date ?? null,
      sequence_no: seq,
      created_by: caller.name,
    }).select().single()
    if (!error) return NextResponse.json({ stage: data as FabDeliveryStage }, { status: 201 })
    if (error.code === '23505') {
      // Pinned number is a genuine conflict; an auto number means someone raced
      // us to it — recompute the max and try the next one.
      if (pinned) return NextResponse.json({ error: 'That build-order number is already used for this job.' }, { status: 409 })
      continue
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ error: 'Could not allocate a build-order number — please retry.' }, { status: 409 })
}
