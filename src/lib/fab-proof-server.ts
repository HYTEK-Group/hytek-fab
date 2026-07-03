// Server-side: load a job's proof photos, sign their URLs, and assemble the pack.
// Shared by the in-app proof view and the token-guarded bridge (Troy's app).
import { getSupabaseAdmin } from './supabase-admin'
import { buildProofPack, type ProofPack, type ProofPhotoView } from './fab-proof-pack'
import type { ProofStage } from './types'

export async function loadProofPack(
  jobId: string,
): Promise<{ pack: ProofPack; total_marks: number; quote_number: string | null } | null> {
  const admin = getSupabaseAdmin()
  const { data: job } = await admin.from('fab_jobs').select('id, quote_number').eq('id', jobId).single()
  if (!job) return null

  const [{ data: photos }, { data: marks }, { data: pkgs }] = await Promise.all([
    admin.from('fab_proof_photos').select('*').eq('fab_job_id', jobId).order('taken_at'),
    admin.from('fab_marks').select('id, mark_id').eq('fab_job_id', jobId),
    admin.from('fab_contractor_packages').select('id, treatment_type, contractor_name').eq('fab_job_id', jobId),
  ])

  const markLabel = new Map((marks ?? []).map(m => [m.id as string, m.mark_id as string]))
  const rows = (photos ?? []) as Array<{
    id: string; stage: ProofStage; treatment_type: string | null
    fab_mark_id: string | null; fab_package_id: string | null; fab_load_id: string | null
    storage_path: string; caption: string | null; taken_by: string; taken_at: string
  }>

  // sign all the storage paths in one call
  const paths = rows.map(r => r.storage_path)
  const signedMap = new Map<string, string>()
  if (paths.length) {
    const { data: signed } = await admin.storage.from('fab-proof').createSignedUrls(paths, 3600)
    for (const s of signed ?? []) if (s.path && s.signedUrl) signedMap.set(s.path, s.signedUrl)
  }

  const views: ProofPhotoView[] = rows.map(r => ({
    id: r.id, stage: r.stage, treatment_type: r.treatment_type,
    fab_mark_id: r.fab_mark_id, fab_package_id: r.fab_package_id, fab_load_id: r.fab_load_id,
    mark_label: r.fab_mark_id ? markLabel.get(r.fab_mark_id) ?? null : null,
    url: signedMap.get(r.storage_path) ?? null,
    caption: r.caption, taken_by: r.taken_by, taken_at: r.taken_at,
  }))

  return {
    pack: buildProofPack(views, (pkgs ?? []) as { id: string; treatment_type: string | null; contractor_name: string | null }[]),
    total_marks: (marks ?? []).length,
    quote_number: job.quote_number,
  }
}
