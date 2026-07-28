// Basic sanity check that an uploaded QA/mill cert is a real document — not a
// blank, a stray screenshot, or the wrong file. It is NOT a content check (a
// supervisor still sights the cert before drop-ship release); it just rejects
// the obviously-wrong at upload so "any PDF passes" stops being true.
const MIN_BYTES = 2048 // a real cert scan / PDF is bigger than 2 KB

export interface CertVerdict { ok: boolean; reason?: string }

export function checkCert(buf: Buffer): CertVerdict {
  if (buf.length < MIN_BYTES) {
    return { ok: false, reason: 'That file looks empty or too small to be a real certificate' }
  }
  const isPdf = buf.subarray(0, 4).toString('latin1') === '%PDF'
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  if (!isPdf && !isJpg && !isPng) {
    return { ok: false, reason: 'A certificate must be a PDF or a photo (JPG/PNG)' }
  }
  return { ok: true }
}
