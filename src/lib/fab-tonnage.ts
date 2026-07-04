// Tonnage rollups for a job's marks. Progress here is weight-driven, not
// count-driven — a 407 kg column must not weigh the same as a 14 kg base
// plate. "Made" = a mark that's been fabricated (status `done`), fully
// approved (`qc_passed`), or drop-ship released on sub certs (`sub_certified`).
// weight_kg is per-piece, so a mark of quantity N contributes weight_kg * N.

export interface TonnageMark {
  status: string
  weight_kg: number | null
  quantity: number | null
}

export interface TonnageSummary {
  total_kg: number
  made_kg: number        // fabricated or approved (status done | qc_passed)
  pct: number            // 0-100, made_kg / total_kg (0 when total is 0)
  missing_weight: number // marks with no/zero weight (tonnage undercount risk)
}

const MADE = new Set(['done', 'qc_passed', 'sub_certified'])

export function tonnageSummary(marks: TonnageMark[]): TonnageSummary {
  let total = 0
  let made = 0
  let missing = 0
  for (const mark of marks) {
    const qty = mark.quantity ?? 1
    const w = (mark.weight_kg ?? 0) > 0 ? (mark.weight_kg as number) : 0 // clamp null/negative
    if (w <= 0) missing++
    const kg = w * qty
    total += kg
    if (MADE.has(mark.status)) made += kg
  }
  const pct = total > 0 ? Math.round((made / total) * 100) : 0
  return { total_kg: total, made_kg: made, pct, missing_weight: missing }
}

/** kg → tonnes, rounded to 2 decimals (for display). */
export function kgToTonnes(kg: number): number {
  return Math.round((kg / 1000) * 100) / 100
}
