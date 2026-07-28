// Server-side image fingerprinting for the proof chain. Every proof photo is
// SHA-256'd by the SERVER (never trusted from the client), and the same exact
// image can't be used twice on a job — closing the "photograph one piece and
// reuse the shot for five marks/stages" fake. Distinct photos of the same piece
// have different bytes, so a genuine re-shoot is never blocked; only a literal
// re-use of the identical file is.
import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export function imageSha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

/** A human message if this exact image is already on the job (any piece/stage), else null. */
export async function duplicatePhotoNote(
  admin: SupabaseClient, jobId: string, sha: string,
): Promise<string | null> {
  const { data } = await admin
    .from('fab_proof_photos')
    .select('stage, fab_marks:fab_mark_id(mark_id)')
    .eq('fab_job_id', jobId)
    .eq('image_sha256', sha)
    .limit(1)
  if (!data || data.length === 0) return null
  const r = data[0] as { stage: string; fab_marks?: { mark_id?: string } | { mark_id?: string }[] | null }
  const mk = Array.isArray(r.fab_marks) ? r.fab_marks[0] : r.fab_marks
  const where = mk?.mark_id ? `${r.stage} · ${mk.mark_id}` : r.stage
  return `This exact photo is already used on this job (${where}). Take a fresh photo of the actual piece.`
}
