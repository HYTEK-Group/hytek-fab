// POST /api/fab/sub/proof — the SUBSTITUTION point: a subcontractor's proof
// photo lands in the SAME append-only fab_proof_photos chain as Brisbane-made
// steel (same bucket, same stages, same evidence lock), so the office proof tab
// and Troy's dispatch pack show it with zero downstream changes. Differences
// from the internal route, all deliberate:
//   • caller is a sub token (getSubCaller), never a kiosk/Supabase caller
//   • fab_package_id is REQUIRED and must be one of the caller's granted
//     packages — the job id is DERIVED from the package, never trusted from
//     the client (a sub cannot attribute photos into someone else's job)
//   • any fab_mark_id must belong to that same package
//   • taken_by is stamped 'SUB: <contractor>' so sub capture is auditable and
//     can never impersonate a Brisbane worker
//   • treatment legs default treatment_type from the package
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getSubCaller, grantedPackage } from '@/lib/fab-sub-auth'
import { imageSha256, duplicatePhotoNote } from '@/lib/fab-photo-dedupe'
import type { ProofStage } from '@/lib/types'

export const dynamic = 'force-dynamic'

const STAGES: ProofStage[] = ['made', 'treatment_out', 'treatment_in', 'bundled', 'loaded']
const MAX_BYTES = 15 * 1024 * 1024 // phone photos; matches practical Vercel limits

export async function POST(req: NextRequest) {
  const caller = await getSubCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  const stage = String(form?.get('stage') ?? '') as ProofStage
  const packageId = String(form?.get('fab_package_id') ?? '')
  if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 })
  if (!STAGES.includes(stage)) return NextResponse.json({ error: 'invalid stage' }, { status: 400 })
  if (!packageId) return NextResponse.json({ error: 'fab_package_id required' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'file too large (15 MB max)' }, { status: 400 })

  // Scoping wall: the package must be granted to THIS sub.
  const pkg = grantedPackage(caller, packageId)
  if (!pkg) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const markId = (form?.get('fab_mark_id') as string) || null
  const caption = (form?.get('caption') as string) || null
  const treatmentType = (form?.get('treatment_type') as string) || pkg.treatment_type || null

  const admin = getSupabaseAdmin()
  // Any referenced mark must belong to this granted package (and thus this job).
  if (markId) {
    const { data } = await admin
      .from('fab_marks').select('id')
      .eq('id', markId).eq('contractor_package_id', packageId).single()
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Fingerprint the image server-side and reject a re-used shot (anti-fraud) —
  // same rule as the internal chain, so a sub can't reuse one photo either.
  const buf = Buffer.from(await file.arrayBuffer())
  const sha = imageSha256(buf)
  const dup = await duplicatePhotoNote(admin, pkg.fab_job_id, sha)
  if (dup) return NextResponse.json({ error: dup }, { status: 409 })

  const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? '.jpg').toLowerCase()
  // Path is FORCED under the package's own job + a sub/ prefix — never client-chosen.
  const path = `${pkg.fab_job_id}/sub/${packageId}/${stage}/${randomUUID()}${ext}`
  const { error: upErr } = await admin.storage.from('fab-proof').upload(path, buf, {
    contentType: file.type || 'image/jpeg', upsert: false,
  })
  if (upErr) return NextResponse.json({ error: 'upload failed: ' + upErr.message }, { status: 500 })

  const { data: row, error } = await admin.from('fab_proof_photos').insert({
    fab_job_id: pkg.fab_job_id, // derived from the grant, never from the client
    fab_mark_id: markId,
    fab_package_id: packageId,
    fab_load_id: null, // subs have no fab_dispatch_loads — load photos key to the package
    stage,
    treatment_type: stage === 'treatment_out' || stage === 'treatment_in' ? treatmentType : null,
    storage_path: path,
    file_name: file.name,
    caption,
    taken_by: caller.stamp,
    image_sha256: sha,
  }).select('id, stage, taken_at').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: signed } = await admin.storage.from('fab-proof').createSignedUrl(path, 3600)
  return NextResponse.json({
    ok: true, id: row.id, stage: row.stage, taken_at: row.taken_at,
    url: signed?.signedUrl ?? null,
  })
}
