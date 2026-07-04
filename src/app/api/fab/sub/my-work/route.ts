// GET /api/fab/sub/my-work — everything the sub may see, and NOTHING else:
// their granted packages, each with its job header (quote + name + due date),
// the pieces to make, per-piece made-photo state, whole-load stage photo counts,
// attached certs, and progress notes. DELIBERATE REDACTIONS: no other jobs, no
// dollars, no internal time-learning fields (allotted/suggested/actual minutes),
// no worker names. A piece is "made" when it has a made proof photo — the photo
// IS the completion event (single source of truth; nothing else to keep in sync).
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getSubCaller } from '@/lib/fab-sub-auth'
import type { CertKind, ProofStage } from '@/lib/types'

export const dynamic = 'force-dynamic'

interface SubPiece {
  id: string
  mark_id: string
  description: string | null
  section: string | null
  length_mm: number | null
  weight_kg: number | null
  quantity: number
  made: boolean
  made_at: string | null
}

export async function GET(req: NextRequest) {
  const caller = await getSubCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getSupabaseAdmin()
  const packages = []
  for (const pkg of caller.packages) {
    const [{ data: job }, { data: marks }, { data: photos }, { data: certs }, { data: updates }] =
      await Promise.all([
        admin.from('fab_jobs')
          .select('quote_number, name, on_site_date')
          .eq('id', pkg.fab_job_id).single(),
        admin.from('fab_marks')
          .select('id, mark_id, description, section, length_mm, weight_kg, quantity')
          .eq('contractor_package_id', pkg.package_id)
          .order('mark_id', { ascending: true }),
        admin.from('fab_proof_photos')
          .select('fab_mark_id, stage, taken_at')
          .eq('fab_package_id', pkg.package_id),
        admin.from('fab_package_certs')
          .select('id, kind, file_name, note, uploaded_at')
          .eq('fab_package_id', pkg.package_id)
          .order('uploaded_at', { ascending: true }),
        admin.from('fab_contractor_updates')
          .select('logged_at, note, reported_pct, eta')
          .eq('package_id', pkg.package_id)
          .order('created_at', { ascending: false })
          .limit(5),
      ])

    // Piece completion = has a made photo (from this package's chain).
    const madeAt = new Map<string, string>()
    const stageCounts: Record<ProofStage, number> = {
      made: 0, treatment_out: 0, treatment_in: 0, bundled: 0, loaded: 0,
    }
    for (const p of photos ?? []) {
      const stage = p.stage as ProofStage
      stageCounts[stage] = (stageCounts[stage] ?? 0) + 1
      if (stage === 'made' && p.fab_mark_id && !madeAt.has(p.fab_mark_id)) {
        madeAt.set(p.fab_mark_id, p.taken_at as string)
      }
    }

    const pieces: SubPiece[] = (marks ?? []).map(m => ({
      id: m.id,
      mark_id: m.mark_id,
      description: m.description,
      section: m.section,
      length_mm: m.length_mm,
      weight_kg: m.weight_kg,
      quantity: m.quantity ?? 1,
      made: madeAt.has(m.id),
      made_at: madeAt.get(m.id) ?? null,
    }))

    packages.push({
      package_id: pkg.package_id,
      job: {
        quote_number: job?.quote_number ?? null,
        name: job?.name ?? null,
        on_site_date: job?.on_site_date ?? null,
      },
      delivery_mode: pkg.delivery_mode,
      status: pkg.status,
      ready_at: pkg.ready_at,
      expected_return_date: pkg.expected_return_date,
      scope_note: pkg.scope_note,
      treatment_type: pkg.treatment_type,
      pieces,
      made_count: pieces.filter(p => p.made).length,
      total_pieces: pieces.length,
      stage_counts: stageCounts,
      certs: (certs ?? []).map(c => ({
        id: c.id, kind: c.kind as CertKind, file_name: c.file_name,
        note: c.note, uploaded_at: c.uploaded_at,
      })),
      recent_updates: updates ?? [],
    })
  }

  return NextResponse.json({ contractor_name: caller.contractor_name, packages })
}
