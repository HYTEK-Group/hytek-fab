/** Stable per-report identity: strips the trailing _IFF_<date> issue suffix and
 *  the extension, so a re-issue of the same report reconciles against / replaces
 *  the right rows instead of being treated as a new source. */
export function stableSource(filename: string): string {
  return filename
    .replace(/\.(xlsx|xls)$/i, '')
    .replace(/_iff_\d{1,2}[.\-]\d{1,2}[.\-]\d{2,4}$/i, '')
    .trim()
}
