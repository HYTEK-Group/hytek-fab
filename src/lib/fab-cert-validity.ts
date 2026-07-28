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
  // iPhone photos are HEIC/HEIF by default — accept them (ftyp box + a HEIF brand).
  const isFtyp = buf.subarray(4, 8).toString('latin1') === 'ftyp'
  const heifBrands = ['heic', 'heix', 'heif', 'mif1', 'msf1', 'hevc', 'hevx', 'heim', 'heis']
  const isHeic = isFtyp && heifBrands.includes(buf.subarray(8, 12).toString('latin1'))
  const isTiff =
    (buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0x00) ||
    (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00 && buf[3] === 0x2a)
  const isWebp =
    buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP'
  if (!isPdf && !isJpg && !isPng && !isHeic && !isTiff && !isWebp) {
    return { ok: false, reason: 'A certificate must be a PDF or a photo (PDF, JPG, PNG, HEIC)' }
  }
  return { ok: true }
}
