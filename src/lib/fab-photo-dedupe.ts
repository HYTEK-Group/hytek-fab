// Server-side image fingerprinting for the proof chain. Every proof photo is
// SHA-256'd by the SERVER (never trusted from the client), and the same exact
// image can't be used twice on a job.
//
// HONEST SCOPE: this is an EXACT-byte check — it blocks a literal re-use of the
// identical file (the lazy "upload the same shot for five marks"). It does NOT
// resist a determined faker who re-saves/alters one byte per copy, and it does
// NOT prove the photo is of the right piece. It's a presence/tamper hygiene
// control; real anti-fraud is the mark-read + the on-site count. A DB-level
// UNIQUE index (sql/011) is the race-proof backstop; this check gives the
// friendly message.
import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export function imageSha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

export type DupResult =
  | { status: 'clear' }
  | { status: 'duplicate'; note: string }
  | { status: 'error' }

/** Postgres unique-violation — the DB-level de-dup backstop (sql/011 unique index). */
export function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === '23505'
}

// Has this EXACT image already been used on this job? Fails CLOSED ('error') if
// the lookup itself fails, so a DB hiccup can't silently disable the control.
// scopePackageIds (sub uploads): a collision in a package the caller wasn't
// granted returns a GENERIC message — never leaks another package's mark label.
export async function duplicatePhotoCheck(
  admin: SupabaseClient,
  jobId: string,
  sha: string,
  opts?: { scopePackageIds?: string[] },
): Promise<DupResult> {
  const { data, error } = await admin
    .from('fab_proof_photos')
    .select('stage, fab_package_id, fab_marks:fab_mark_id(mark_id)')
    .eq('fab_job_id', jobId)
    .eq('image_sha256', sha)
    .limit(1)
  if (error) return { status: 'error' }
  if (!data || data.length === 0) return { status: 'clear' }

  const generic = 'This exact photo is already used on this job. Take a fresh photo of the actual piece.'
  const r = data[0] as {
    stage: string
    fab_package_id: string | null
    fab_marks?: { mark_id?: string } | { mark_id?: string }[] | null
  }
  // Sub caller: only reveal the piece/stage if the collision is inside a package they hold.
  if (opts?.scopePackageIds && !(r.fab_package_id && opts.scopePackageIds.includes(r.fab_package_id))) {
    return { status: 'duplicate', note: generic }
  }
  const mk = Array.isArray(r.fab_marks) ? r.fab_marks[0] : r.fab_marks
  const where = mk?.mark_id ? `${r.stage} · ${mk.mark_id}` : r.stage
  return { status: 'duplicate', note: `This exact photo is already used on this job (${where}). Take a fresh photo of the actual piece.` }
}
