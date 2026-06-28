/** Stable per-report identity: strips the trailing _IFF_<date> issue suffix and
 *  the extension, so a re-issue of the same report reconciles against / replaces
 *  the right rows instead of being treated as a new source. */
export function stableSource(filename: string): string {
  return filename
    .replace(/\.(xlsx|xls)$/i, '')
    .replace(/_iff_\d{1,2}[.\-]\d{1,2}[.\-]\d{2,4}$/i, '')
    .trim()
}

/** Parse the _IFF_<d.m.yy> issue date from a Tekla report filename → epoch ms,
 *  or -1 when absent. Lets us keep the NEWEST issue when several copies of one
 *  report (same stableSource) are present at once. */
export function iffDate(filename: string): number {
  const m = filename.match(/_iff_(\d{1,2})[.\-](\d{1,2})[.\-](\d{2,4})/i)
  if (!m) return -1
  const d = Number(m[1]), mo = Number(m[2])
  const yy = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  const t = new Date(yy, mo - 1, d).getTime()
  return Number.isFinite(t) ? t : -1
}
