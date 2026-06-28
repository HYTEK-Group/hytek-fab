// Pure parser for a Tekla "Assembly List" report (exported to xlsx by the
// detailer, IFF = Issued For Fabrication). Works on the sheet as a 2-D array of
// cells — the xlsx→rows extraction (a thin adapter using a lib) lives in the
// route/bridge, so this stays pure and testable.
//
// Real layout (HG260012): a title block (Project Number / Name / Building / Date,
// "ISSUED FOR ..."), then a 2-row header beginning "Assembly Mark", then rows:
//   Assembly Mark | Qty | Profile | Name | Length (mm) | Weight(kg) one | …all | Area one | …all | Coating
// Weight is PER ONE; a mark of qty N weighs weight_kg × N.

export type Cell = string | number | null | undefined
export type Row = Cell[]

export interface ParsedMark {
  mark_id: string
  quantity: number
  section: string | null
  description: string | null // Tekla "Name" e.g. BEAM / COLUMN
  length_mm: number | null
  weight_kg: number | null // per one
  coating: string | null
}

export interface ParsedAssemblyList {
  project_number: string | null
  issued_status: string | null // e.g. "ISSUED FOR APPROVAL" / "ISSUED FOR FABRICATION"
  date: string | null
  marks: ParsedMark[]
  total_kg: number // Σ weight_kg × quantity
}

const str = (c: Cell): string => (c === null || c === undefined ? '' : String(c).trim())

const num = (c: Cell): number | null => {
  if (c === null || c === undefined || c === '') return null
  const n = typeof c === 'number' ? c : parseFloat(String(c).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

const findCol = (header: Row, pred: (v: string) => boolean): number =>
  header.findIndex(c => pred(str(c).toLowerCase()))

export function parseAssemblyRows(rows: Row[]): ParsedAssemblyList {
  let project_number: string | null = null
  let date: string | null = null
  let issued_status: string | null = null

  // Title block — scan the first handful of rows.
  for (const r of rows.slice(0, 8)) {
    const label = str(r[0]).toLowerCase()
    if (label.includes('project number') && !project_number) project_number = str(r[1]) || null
    if (label.includes('date') && !date) date = str(r[1]) || null
    if (!issued_status) {
      const m = r.map(str).join(' ').match(/issued for [a-z]+/i)
      if (m) issued_status = m[0].toUpperCase()
    }
  }

  const h = rows.findIndex(r => r.some(c => str(c).toLowerCase() === 'assembly mark'))
  if (h === -1) return { project_number, issued_status, date, marks: [], total_kg: 0 }

  const header = rows[h]
  const sub = rows[h + 1] ?? []
  const markCol = findCol(header, v => v === 'assembly mark')
  const qtyCol = findCol(header, v => v === 'qty')
  const profileCol = findCol(header, v => v === 'profile')
  const nameCol = findCol(header, v => v === 'name')
  const lengthCol = findCol(header, v => v.startsWith('length'))
  const coatingCol = findCol(header, v => v.includes('coating'))

  // Two "Assembly Weight" columns (one / all). Prefer the one whose sub-header
  // says "for one"; else the first weight column.
  const weightCols = header
    .map((c, i) => ({ i, v: str(c).toLowerCase() }))
    .filter(x => x.v.includes('weight'))
    .map(x => x.i)
  let weightOneCol = weightCols.length ? weightCols[0] : -1
  for (const i of weightCols) {
    if (str(sub[i]).toLowerCase().includes('for one')) { weightOneCol = i; break }
  }

  const marks: ParsedMark[] = []
  let total = 0
  for (let i = h + 2; i < rows.length; i++) {
    const r = rows[i]
    const mark = str(r[markCol])
    if (!mark || mark.toLowerCase().startsWith('total')) continue
    const quantity = Math.max(1, Math.round(num(r[qtyCol]) ?? 1))
    const weight = weightOneCol >= 0 ? num(r[weightOneCol]) : null
    const length = lengthCol >= 0 ? num(r[lengthCol]) : null
    marks.push({
      mark_id: mark,
      quantity,
      section: profileCol >= 0 ? str(r[profileCol]) || null : null,
      description: nameCol >= 0 ? str(r[nameCol]) || null : null,
      length_mm: length === null ? null : Math.round(length),
      weight_kg: weight,
      coating: coatingCol >= 0 ? str(r[coatingCol]) || null : null,
    })
    total += (weight ?? 0) * quantity
  }

  return { project_number, issued_status, date, marks, total_kg: Math.round(total * 100) / 100 }
}
