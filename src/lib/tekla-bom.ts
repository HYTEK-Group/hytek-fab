// Pure parser for the Tekla "bill of materials" reports (exported to xlsx by the
// detailer alongside the Assembly List). PURCHASING reads the result (job_bom).
// One report file = one category; the xlsx→rows extraction (a thin lib adapter)
// lives in the route/bridge so this stays pure and testable.
//
// Categories (job_bom.category) and their source reports:
//   section  ← Part Material List ("For Ordering"): Part Mark | Profile | Grade |
//             Coating | Net/Gross Length | Net Weight (one/all) | From Stock | From Order
//   plate    ← Plate Part List:  Part Mark | Profile (FL10*150) | Qty | Material | Length | Weight
//   bolt     ← Bolt Summary / Erection Bolt List: Dia | Grade | Finish | Length | Qty
//   chemset  ← Chemset Tube Summary: spec + qty
//   loose    ← Loose Plate List
//   misc     ← Miscellaneous List
//
// Tekla templates drift between report types, so columns are matched by fuzzy
// header predicates (not fixed positions) — the same approach as tekla-assembly.ts.

export type Cell = string | number | null | undefined
export type Row = Cell[]

export type BomCategory = 'section' | 'plate' | 'bolt' | 'chemset' | 'loose' | 'misc'

export interface BomLine {
  category: BomCategory
  part_mark: string | null
  profile: string | null // section/plate profile, or bolt dia/size
  grade: string | null
  length_mm: number | null
  qty: number | null
  weight_kg: number | null // per one
  from_stock: boolean | null
  from_order: boolean | null
}

const str = (c: Cell): string => (c === null || c === undefined ? '' : String(c).trim())

const num = (c: Cell): number | null => {
  if (c === null || c === undefined || c === '') return null
  const n = typeof c === 'number' ? c : parseFloat(String(c).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** yes/y/x/true/1 → true; no/n/false/0/'' → false; nothing usable → null. */
const bool = (c: Cell): boolean | null => {
  if (c === null || c === undefined) return null
  const s = String(c).trim().toLowerCase()
  if (s === '') return null
  if (['yes', 'y', 'x', 'true', '1', '✓'].includes(s)) return true
  if (['no', 'n', 'false', '0', '-'].includes(s)) return false
  const n = num(c)
  if (n !== null) return n > 0
  return null
}

const findCol = (header: Row, pred: (v: string) => boolean): number =>
  header.findIndex(c => pred(str(c).toLowerCase()))

/** Map a report filename to its job_bom category. null = not a BOM report. */
export function bomCategoryFromFilename(name: string): BomCategory | null {
  const n = name.toLowerCase()
  if (n.includes('assembly')) return null // the marks list, not a BOM report
  if (n.includes('loose')) return 'loose' // "Loose Plate List" — before plate
  if (n.includes('plate')) return 'plate'
  if (n.includes('bolt')) return 'bolt'
  if (n.includes('chemset') || n.includes('chem set') || n.includes('chemical') || n.includes('tube')) return 'chemset'
  if (n.includes('part material') || n.includes('material list') || n.includes('for ordering')) return 'section'
  if (n.includes('misc')) return 'misc'
  return null
}

/** Is this header row the column header (vs a title/blank row)? Needs ≥2 known columns. */
function looksLikeHeader(row: Row): boolean {
  const cells = row.map(c => str(c).toLowerCase())
  let hits = 0
  for (const v of cells) {
    if (
      v.includes('mark') || v.includes('profile') || v.includes('section') ||
      v === 'qty' || v.includes('quantity') || v.includes('weight') ||
      v.includes('length') || v.includes('dia') || v.includes('grade') ||
      v.includes('material') || v.includes('size')
    ) hits++
  }
  return hits >= 2
}

export interface ParsedBom {
  category: BomCategory
  lines: BomLine[]
}

export function parseBomRows(rows: Row[], category: BomCategory): ParsedBom {
  const h = rows.findIndex(looksLikeHeader)
  if (h === -1) return { category, lines: [] }

  const header = rows[h]
  const sub = rows[h + 1] ?? []

  const markCol = findCol(header, v => v.includes('mark'))
  // profile: explicit profile/section/size first, then bolt "dia/diameter"
  let profileCol = findCol(header, v => v.includes('profile') || v.includes('section') || v.includes('size'))
  if (profileCol === -1) profileCol = findCol(header, v => v.includes('dia'))
  const gradeCol = findCol(header, v => v.includes('grade') || v.includes('material'))
  const lengthCol = findCol(header, v => v.includes('length'))
  const qtyCol = findCol(header, v => v === 'qty' || v.includes('quantity') || v === 'no' || v === 'no.')
  const stockCol = findCol(header, v => v.includes('stock'))
  const orderCol = findCol(header, v => v.includes('from order') || v === 'order' || v === 'to order')

  // Two weight columns (one / all) — prefer the per-one column.
  const weightCols = header
    .map((c, i) => ({ i, v: str(c).toLowerCase() }))
    .filter(x => x.v.includes('weight'))
    .map(x => x.i)
  let weightOneCol = weightCols.length ? weightCols[0] : -1
  for (const i of weightCols) {
    const label = (str(header[i]) + ' ' + str(sub[i])).toLowerCase()
    if (label.includes('one')) { weightOneCol = i; break }
  }

  const lines: BomLine[] = []
  // Data starts after the header; if the sub-row is a continuation header (no
  // numeric/identifier content under the key columns), skip it too.
  let start = h + 1
  const subIsHeader = looksLikeHeader(sub) || (markCol >= 0 && str(sub[markCol]) === '' && qtyCol >= 0 && num(sub[qtyCol]) === null)
  if (subIsHeader) start = h + 2

  for (let i = start; i < rows.length; i++) {
    const r = rows[i]
    const mark = markCol >= 0 ? str(r[markCol]) : ''
    const profile = profileCol >= 0 ? str(r[profileCol]) : ''
    const qty = qtyCol >= 0 ? num(r[qtyCol]) : null
    const weight = weightOneCol >= 0 ? num(r[weightOneCol]) : null
    // Skip totals + fully empty rows.
    const firstLabel = (mark || profile).toLowerCase()
    if (firstLabel.startsWith('total') || firstLabel.startsWith('grand')) continue
    if (!mark && !profile && qty === null && weight === null) continue

    lines.push({
      category,
      part_mark: mark || null,
      profile: profile || null,
      grade: gradeCol >= 0 ? str(r[gradeCol]) || null : null,
      length_mm: lengthCol >= 0 ? (num(r[lengthCol]) === null ? null : Math.round(num(r[lengthCol])!)) : null,
      qty,
      weight_kg: weight,
      from_stock: stockCol >= 0 ? bool(r[stockCol]) : null,
      from_order: orderCol >= 0 ? bool(r[orderCol]) : null,
    })
  }

  return { category, lines }
}
