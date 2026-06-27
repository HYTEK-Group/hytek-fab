// Plain-English progress paragraph for the Hub feed. `today` is injectable
// so date comparisons are deterministic in tests.
import type { FabProgressPackageSummary, FabProgressLoadSummary } from './types'

export interface NarrativeInput {
  inhouse_total: number
  inhouse_complete: number
  contractor_packages: FabProgressPackageSummary[]
  dispatch_loads: FabProgressLoadSummary[]
  rework_total: number
  on_site_date: string | null
}

function packagePhrase(p: FabProgressPackageSummary): string {
  const head = `${p.contractor_name}${p.scope_note ? ` — ${p.scope_note}` : ''}`
  let tail: string
  switch (p.status) {
    case 'inspected':
      tail = 'complete and QC approved'
      break
    case 'returned':
      tail = `received back${p.returned_at ? ` ${p.returned_at}` : ''}, pending QC inspection`
      break
    case 'in_progress':
      if (p.last_update_note) {
        tail = `${p.pct}% per call ${p.last_update_date}` +
          (p.expected_return_date ? `, ETA ${p.expected_return_date}` : '')
      } else {
        tail = 'in progress'
      }
      break
    case 'sent':
      tail = p.last_update_note
        ? `${p.pct}% per call ${p.last_update_date}`
        : 'sent, awaiting update'
      break
    default:
      tail = 'not yet sent'
  }
  return `${head}: ${tail}.`
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso + 'T00:00:00Z').getTime()
  const to = new Date(toIso + 'T00:00:00Z').getTime()
  return Math.round((to - from) / 86_400_000)
}

export function buildNarrative(input: NarrativeInput, today: string): string {
  const parts: string[] = []

  if (input.inhouse_total > 0) {
    const pct = Math.round((input.inhouse_complete / input.inhouse_total) * 100)
    parts.push(
      `In-house fabrication ${pct}% complete (${input.inhouse_complete}/${input.inhouse_total} marks).`,
    )
  }

  for (const p of input.contractor_packages) {
    parts.push(packagePhrase(p))
  }

  if (input.rework_total > 0) {
    parts.push(`Note: ${input.rework_total} mark(s) required rework.`)
  }

  for (const l of input.dispatch_loads) {
    if (l.dispatched_at) {
      parts.push(`Load ${l.load_number} dispatched ${l.dispatched_at} (${l.total_marks} marks).`)
    } else if (l.planned_date) {
      parts.push(`Load ${l.load_number} planned ${l.planned_date} (${l.total_marks} marks).`)
    } else {
      parts.push(`Load ${l.load_number} pending (${l.total_marks} marks).`)
    }
  }

  if (input.on_site_date) {
    const days = daysBetween(today, input.on_site_date)
    parts.push(days > 7 ? 'On track for on-site date.' : 'On-site date approaching.')
  }

  return parts.join(' ')
}
