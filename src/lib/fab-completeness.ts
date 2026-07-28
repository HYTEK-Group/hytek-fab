// The traceability completeness gate (pure → testable). A job can't be declared
// fab-complete / alerted to dispatch until EVERY piece has a 'made' proof photo.
// It NAMES the pieces still missing one, so the floor finds them before the
// truck — not after. Bundled/loaded are reported for context (they're captured
// per load at truck time), but the hard gate is: every piece photographed made.

export interface CompMark { id: string; mark_id: string }
export interface CompPhoto { fab_mark_id: string | null; stage: string }

export interface Completeness {
  total: number
  made: number
  missing_marks: string[] // human mark labels with no 'made' photo
  has_bundled: boolean
  has_loaded: boolean
  ready: boolean
  blockers: string[]
}

export function computeCompleteness(marks: CompMark[], photos: CompPhoto[]): Completeness {
  const madeIds = new Set(
    photos.filter(p => p.stage === 'made' && p.fab_mark_id).map(p => p.fab_mark_id as string),
  )
  const missing = marks.filter(m => !madeIds.has(m.id))
  const has_bundled = photos.some(p => p.stage === 'bundled')
  const has_loaded = photos.some(p => p.stage === 'loaded')

  const blockers: string[] = []
  if (marks.length === 0) {
    blockers.push('No pieces on this job')
  } else if (missing.length > 0) {
    const names = missing.slice(0, 12).map(m => m.mark_id).join(', ')
    blockers.push(
      `${missing.length} of ${marks.length} pieces have no photo — find and photograph: ${names}${missing.length > 12 ? ` +${missing.length - 12} more` : ''}`,
    )
  }

  return {
    total: marks.length,
    made: marks.length - missing.length,
    missing_marks: missing.map(m => m.mark_id),
    has_bundled,
    has_loaded,
    ready: blockers.length === 0,
    blockers,
  }
}
