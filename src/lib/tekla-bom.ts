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

const tokens = (v: string): string[] => v.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
const qtyCell = (v: string): boolean => {
  const t = tokens(v)
  return t.includes('qty') || t.includes('quantity') || t.includes('count') || t.includes('pieces') || v.includes('no off')
}

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

/** Does a cell look like a recognised BOM COLUMN header? Token-based (whole words)
 *  so a title row like "Diaphragm plate" doesn't match 'dia'/'plate' as a column. */
function cellIsColumn(v: string): boolean {
  const t = tokens(v)
  const has = (w: string) => t.includes(w)
  if (v.includes('part mark') || has('mark')) return true
  if (has('profile') || has('section') || has('size')) return true
  if (qtyCell(v)) return true
  if (has('weight')) return true
  if (has('length')) return true
  if (has('dia') || has('diameter')) return true
  if (has('grade') || has('material')) return true
  return false
}

/** How many recognised column cells a row has (its "header-ness" score). */
function scoreHeader(row: Row): number {
  return row.reduce<number>((n, c) => n + (cellIsColumn(str(c)) ? 1 : 0), 0)
}

/** The BEST header row index (max recognised columns, ≥2), earliest on a tie —
 *  so a title row that happens to share one keyword can't hijack detection. */
function headerRowIndex(rows: Row[]): number {
  let best = -1, bestScore = 1 // require ≥2 to beat this
  for (let i = 0; i < rows.length; i++) {
    const s = scoreHeader(rows[i])
    if (s > bestScore) { bestScore = s; best = i }
  }
  return best
}

export interface ParsedBom {
  category: BomCategory
  lines: BomLine[]
}

export function parseBomRows(rows: Row[], category: BomCategory): ParsedBom {
  const h = headerRowIndex(rows)
  if (h === -1) return { category, lines: [] }

  const header = rows[h]
  const sub = rows[h + 1] ?? []

  const markCol = findCol(header, v => v.includes('mark'))
  // profile: explicit profile/section/size first, then bolt "dia/diameter"
  let profileCol = findCol(header, v => v.includes('profile') || v.includes('section') || v.includes('size'))
  if (profileCol === -1) profileCol = findCol(header, v => v.includes('dia'))
  const gradeCol = findCol(header, v => v.includes('grade') || v.includes('material'))
  const lengthCol = findCol(header, v => v.includes('length'))
  const qtyCol = findCol(header, qtyCell)
  const stockCol = findCol(header, v => v.includes('stock'))
  const orderCol = findCol(header, v => v.includes('from order') || v === 'order' || v === 'to order')

  // Weight: prefer the PER-ONE column (one/each/unit). Never default to an
  // all-up/total column when a non-total weight column exists — storing the
  // all-up weight as weight_kg (per one) would inflate the BOM.
  const weightCols = header
    .map((c, i) => ({ i, v: str(c).toLowerCase() }))
    .filter(x => x.v.includes('weight'))
    .map(x => x.i)
  const wLabel = (i: number) => (str(header[i]) + ' ' + str(sub[i])).toLowerCase()
  let weightOneCol = weightCols.find(i => /\b(one|each|unit)\b/.test(wLabel(i))) ?? -1
  if (weightOneCol === -1) weightOneCol = weightCols.find(i => !/\b(all|total)\b/.test(wLabel(i))) ?? weightCols[0] ?? -1

  const lines: BomLine[] = []
  // Data starts after the header; if the sub-row is a continuation header (no
  // numeric/identifier content under the key columns), skip it too.
  let start = h + 1
  const subIsHeader = scoreHeader(sub) >= 2 || (markCol >= 0 && str(sub[markCol]) === '' && qtyCol >= 0 && num(sub[qtyCol]) === null)
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
