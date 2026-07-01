// Pick the shop-drawing PDF for an assembly out of a job's uploaded files.
// The drawings come as combined PDFs per block (…_ASSEMBLIES…pdf, plus PLATES /
// SHAFTS and the report PDFs). We prefer the ASSEMBLIES drawing and, when a job
// has several blocks, pick the one whose name best matches the mark's source
// (its block). PURE → testable. (Exact page-within-PDF is a later refinement.)

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const tokens = (s: string): string[] => (norm(s).match(/[a-z0-9]{3,}/g) ?? [])

/** Is this a REPORT pdf (Assembly List / Bolt Summary / material list…) rather
 *  than a shop DRAWING (ASSEMBLIES / PLATES / SHAFTS)? */
function isReport(name: string): boolean {
  return /list|summary|material|bolt|chemset|processing|tmi/i.test(name)
}

export function pickAssemblyDrawing(names: string[], sourceFile: string | null): string | null {
  const pdfs = names.filter(n => /\.pdf$/i.test(n))
  // Only ever return a real drawing — never a report. If none is uploaded yet the
  // route returns "no drawing found" rather than opening a bolt list as the drawing.
  const drawings = pdfs.filter(n => !isReport(n))
  if (drawings.length === 0) return null
  const assemblies = drawings.filter(n => /assembl/i.test(n))
  const pool = assemblies.length ? assemblies : drawings
  if (pool.length === 1) return pool[0]

  // score each candidate by how many source tokens (block, job no) it shares.
  const srcToks = tokens(sourceFile ?? '')
  let best = pool[0], bestScore = -1
  for (const n of pool) {
    const nn = norm(n)
    let score = 0
    for (const t of srcToks) if (nn.includes(t)) score += t.length
    if (score > bestScore) { bestScore = score; best = n }
  }
  return best
}
