// POST /api/fab/proof — add one proof photo to the chain. Multipart form:
//   file (image), stage (made|treatment_out|treatment_in|bundled|loaded),
//   fab_job_id, and one of fab_mark_id / fab_package_id / fab_load_id,
//   treatment_type?, caption?. Any signed-in floor user can ADD a photo (it's an
//   append-only evidence log — tampering is blocked at the DB by the lock trigger).
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getUserCaller } from '@/lib/fab-auth'
import { imageSha256, duplicatePhotoCheck, isUniqueViolation } from '@/lib/fab-photo-dedupe'
import type { ProofStage } from '@/lib/types'

export const dynamic = 'force-dynamic'

const STAGES: ProofStage[] = ['made', 'treatment_out', 'treatment_in', 'bundled', 'loaded']

export async function POST(req: NextRequest) {
  const caller = await getUserCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  const stage = String(form?.get('stage') ?? '') as ProofStage
  const jobId = String(form?.get('fab_job_id') ?? '')
  if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 })
  if (!STAGES.includes(stage)) return NextResponse.json({ error: 'invalid stage' }, { status: 400 })
  if (!jobId) return NextResponse.json({ error: 'fab_job_id required' }, { status: 400 })

  const markId = (form?.get('fab_mark_id') as string) || null
  const packageId = (form?.get('fab_package_id') as string) || null
  const loadId = (form?.get('fab_load_id') as string) || null
  const treatmentType = (form?.get('treatment_type') as string) || null
  const caption = (form?.get('caption') as string) || null

  const admin = getSupabaseAdmin()
  const { data: job } = await admin.from('fab_jobs').select('id').eq('id', jobId).single()
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  // any referenced mark/package/load must belong to this job (no cross-job attribution)
  for (const [table, refId] of [['fab_marks', markId], ['fab_contractor_packages', packageId], ['fab_dispatch_loads', loadId]] as const) {
    if (refId) {
      const { data } = await admin.from(table).select('id').eq('id', refId).eq('fab_job_id', jobId).single()
      if (!data) return NextResponse.json({ error: `${table} not in this job` }, { status: 400 })
    }
  }

  // Fingerprint the image server-side and reject a re-used shot. Fails CLOSED:
  // a lookup error blocks the upload rather than silently letting a dup through.
  const buf = Buffer.from(await file.arrayBuffer())
  const sha = imageSha256(buf)
  const dup = await duplicatePhotoCheck(admin, jobId, sha)
  if (dup.status === 'error') return NextResponse.json({ error: 'Could not verify the photo, try again' }, { status: 503 })
  if (dup.status === 'duplicate') return NextResponse.json({ error: dup.note }, { status: 409 })

  const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? '.jpg').toLowerCase()
  const path = `${jobId}/${stage}/${randomUUID()}${ext}`
  const { error: upErr } = await admin.storage.from('fab-proof').upload(path, buf, {
    contentType: file.type || 'image/jpeg', upsert: false,
  })
  if (upErr) return NextResponse.json({ error: 'upload failed: ' + upErr.message }, { status: 500 })

  const { data: row, error } = await admin.from('fab_proof_photos').insert({
    fab_job_id: jobId, fab_mark_id: markId, fab_package_id: packageId, fab_load_id: loadId,
    stage, treatment_type: treatmentType, storage_path: path, file_name: file.name,
    caption, taken_by: caller.name, image_sha256: sha,
  }).select('id, stage, taken_at').single()
  if (error) {
    // DB-level unique index (sql/011) is the race-proof backstop for the dedupe.
    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: 'This exact photo is already used on this job. Take a fresh photo of the actual piece.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { data: signed } = await admin.storage.from('fab-proof').createSignedUrl(path, 3600)
  return NextResponse.json({ ok: true, id: row.id, stage: row.stage, taken_at: row.taken_at, url: signed?.signedUrl ?? null })
}
