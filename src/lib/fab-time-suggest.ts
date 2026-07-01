// Learning time-suggestion for an assembly. PURE (no DB) → testable.
//
// The suggestion is a transparent look-back over completed assemblies, NOT a
// black box. It groups history by member type (BEAM/COLUMN/PLATE…) and profile
// family (UC/PFC/SHS…) and learns minutes-PER-TONNE for that category, then
// scales by this assembly's tonnage. Grouping by category is what makes it smart
// — a fiddly base plate and a plain beam have very different minutes/tonne even
// at the same weight.
//
// Signals over time:
//   • cold start (no history)      → weight ÷ a shop default rate
//   • a few completed of that kind → the category's median actual minutes/tonne
//   • the supervisor's edits + the floor's actuals both flow in as more get
//     built, so the suggestion converges on what the steel really takes.

export interface HistoryMark {
  description: string | null // Tekla "Name" e.g. BEAM / COLUMN
  section: string | null     // profile e.g. 310UC97, PFC150*75, FL20
  weight_kg: number | null   // per one
  quantity: number | null
  actual_minutes: number | null // floor ground truth (only these teach)
}

export interface SuggestInput {
  description: string | null
  section: string | null
  weight_kg: number | null
  quantity: number | null
}

export interface Suggestion {
  minutes: number
  basis: string                 // human "why" — always shown, never a black box
  source: 'history' | 'rate'
  scope: 'category' | 'shop' | 'default'
  samples: number
  confidence: 'low' | 'medium' | 'good'
}

const DEFAULT_MIN_PER_TONNE = 240 // cold-start only (~4 h/t); the supervisor edits it
const MIN_SAMPLES = 4

/** Member type from the Tekla Name: BEAM / COLUMN / PLATE / … Scans the whole
 *  name for a keyword (so "base plate" → PLATE), else falls back to the first word. */
export function memberType(description: string | null): string {
  const s = String(description ?? '').toUpperCase()
  if (!s.trim()) return 'OTHER'
  if (s.includes('COL')) return 'COLUMN'
  if (s.includes('BEAM')) return 'BEAM'
  if (s.includes('BRAC')) return 'BRACE'
  if (s.includes('PURL')) return 'PURLIN'
  if (s.includes('PLATE') || s.includes('CLEAT')) return 'PLATE'
  return s.match(/[A-Z]+/)?.[0] ?? 'OTHER'
}

/** Profile family from the section: 310UC97→UC, PFC150*75→PFC, SHS100*100*4→SHS, FL20→FL */
export function sectionFamily(section: string | null): string {
  const s = String(section ?? '').toUpperCase()
  const known = ['PFC', 'SHS', 'RHS', 'CHS', 'UC', 'UB', 'UA', 'EA', 'BP', 'FL', 'PL', 'TFB', 'TFC']
  for (const k of known) if (s.includes(k)) return k
  const m = s.match(/[A-Z]{1,4}/)
  return m?.[0] ?? 'OTHER'
}

export function categoryKey(m: { description: string | null; section: string | null }): string {
  return `${memberType(m.description)}|${sectionFamily(m.section)}`
}

const tonnes = (weight_kg: number | null, quantity: number | null): number =>
  (Math.max(0, weight_kg ?? 0) * Math.max(1, Math.round(quantity ?? 1))) / 1000

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

const round15 = (n: number): number => Math.max(15, Math.round(n / 15) * 15)

/** minutes-per-tonne for a completed history mark (null if not usable). */
function minPerTonne(m: HistoryMark): number | null {
  const t = tonnes(m.weight_kg, m.quantity)
  if (t <= 0 || m.actual_minutes == null || m.actual_minutes <= 0) return null
  return m.actual_minutes / t
}

export function suggestMinutes(
  input: SuggestInput,
  history: HistoryMark[],
  opts?: { defaultMinPerTonne?: number; minSamples?: number },
): Suggestion {
  const defRate = opts?.defaultMinPerTonne ?? DEFAULT_MIN_PER_TONNE
  const minN = opts?.minSamples ?? MIN_SAMPLES
  const t = tonnes(input.weight_kg, input.quantity)
  const key = categoryKey(input)
  const type = memberType(input.description)
  const fam = sectionFamily(input.section)

  const catRates = history
    .filter(h => categoryKey(h) === key)
    .map(minPerTonne)
    .filter((x): x is number => x != null)
  const allRates = history.map(minPerTonne).filter((x): x is number => x != null)

  let rate: number, scope: Suggestion['scope'], samples: number, basis: string, source: Suggestion['source'], confidence: Suggestion['confidence']

  if (catRates.length >= minN) {
    rate = median(catRates); scope = 'category'; samples = catRates.length; source = 'history'; confidence = 'good'
    basis = `from ${samples} similar ${type.toLowerCase()} (${fam}) you've built`
  } else if (allRates.length >= minN) {
    rate = median(allRates); scope = 'shop'; samples = allRates.length; source = 'history'; confidence = 'medium'
    basis = `from ${samples} completed assemblies (shop average — not enough ${fam} yet)`
  } else {
    rate = defRate; scope = 'default'; samples = allRates.length; source = 'rate'; confidence = 'low'
    basis = 'weight × shop rate (no history yet — your edits will teach it)'
  }

  const minutes = t > 0 ? round15(rate * t) : 30
  return { minutes, basis, source, scope, samples, confidence }
}
