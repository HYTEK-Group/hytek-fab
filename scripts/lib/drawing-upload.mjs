/**
 * Send one shop drawing PDF to fab's fab-drawings bucket without putting its
 * bytes through fab.
 *
 * Fab runs on Vercel, which refuses any request body over 4.5 MB before the
 * route runs. 54 of the 2,316 drawing PDFs on the drive are bigger (measured
 * 17/09/2026), including the combined ASSEMBLIES PDFs the drawing matcher looks
 * for first, up to 26 MB. So:
 *   1. check the bytes really are a PDF (fab never sees them now);
 *   2. POST {name, size} to /api/fab/jobs/{id}/drawings — fab checks the
 *      supervisor token, the name, the job and the size, and returns a signed
 *      upload URL for fab-drawings/{job number}/{name};
 *   3. PUT the bytes to that URL. The URL carries its own one-off token, so the
 *      bridge still holds no database or storage credential.
 *
 * Returns { ok: true, path } or { ok: false, error } — never throws for an HTTP
 * refusal, so the caller can log the file and carry on with the next one.
 */
export async function uploadDrawing({ fabUrl, token, jobId, name, bytes, fetch: doFetch = fetch }) {
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return { ok: false, error: 'not a PDF (the file does not start with %PDF-)' }
  }

  const ask = await doFetch(`${fabUrl}/api/fab/jobs/${jobId}/drawings`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, size: bytes.length }),
  })
  const signed = await ask.json().catch(() => ({}))
  if (!ask.ok) return { ok: false, error: `fab refused the upload: HTTP ${ask.status} ${signed?.error || ''}`.trim() }
  if (!signed?.signedUrl) return { ok: false, error: 'fab answered with no signed upload URL' }

  const put = await doFetch(signed.signedUrl, {
    method: 'PUT',
    headers: { 'content-type': 'application/pdf', 'x-upsert': 'true', 'cache-control': 'max-age=3600' },
    body: bytes,
  })
  if (!put.ok) {
    const e = await put.json().catch(() => ({}))
    return { ok: false, error: `storage refused the file: HTTP ${put.status} ${e?.message || e?.error || ''}`.trim() }
  }
  return { ok: true, path: signed.path }
}
