// Pure reconcile between a parsed Assembly List and the marks already in the job.
// Drives safe (re-)import: new marks are added; spec changes apply ONLY to marks
// with no work and not hand-edited; marks with work (or manually edited) are
// PROTECTED — surfaced for review, never silently overwritten; removed marks are
// never deleted (surfaced, especially if already fabricated).
import type { ParsedMark } from './tekla-assembly'

export interface ExistingMark {
  mark_id: string
  status: string
  section: string | null
  length_mm: number | null
  weight_kg: number | null
  quantity: number
  manually_edited?: boolean | null
  contractor_package_id?: string | null
  dispatch_load_id?: string | null
  rework_count?: number | null
}

export type ChangeKind = 'added' | 'changed' | 'removed' | 'unchanged'

export interface MarkDiff {
  mark_id: string
  kind: ChangeKind
  parsed?: ParsedMark
  existing?: ExistingMark
  hasWork: boolean    // existing has progress/links
  isProtected: boolean // hasWork || manually_edited → never auto-apply
  fields?: string[]    // which spec fields changed (for 'changed')
}

export interface ImportDiff {
  added: MarkDiff[]
  changed: MarkDiff[]
  removed: MarkDiff[]
  unchanged: MarkDiff[]
}

/** A mark has work against it if it's progressed beyond not_started, been
 *  reworked, or is locked to a contractor package / dispatch load. */
export function markHasWork(m: ExistingMark): boolean {
  return (
    (!!m.status && m.status !== 'not_started') ||
    !!m.contractor_package_id ||
    !!m.dispatch_load_id ||
    (m.rework_count ?? 0) > 0
  )
}

export function diffMarks(parsed: ParsedMark[], existing: ExistingMark[]): ImportDiff {
  const exByKey = new Map(existing.map(m => [m.mark_id.toUpperCase(), m]))
  const paKeys = new Set(parsed.map(m => m.mark_id.toUpperCase()))
  const out: ImportDiff = { added: [], changed: [], removed: [], unchanged: [] }

  for (const p of parsed) {
    const ex = exByKey.get(p.mark_id.toUpperCase())
    if (!ex) {
      out.added.push({ mark_id: p.mark_id, kind: 'added', parsed: p, hasWork: false, isProtected: false })
      continue
    }
    const fields: string[] = []
    if ((ex.section ?? '') !== (p.section ?? '')) fields.push('section')
    if ((ex.length_mm ?? null) !== (p.length_mm ?? null)) fields.push('length_mm')
    if (Number(ex.weight_kg ?? 0) !== Number(p.weight_kg ?? 0)) fields.push('weight_kg')
    if ((ex.quantity ?? 1) !== (p.quantity ?? 1)) fields.push('quantity')
    const hasWork = markHasWork(ex)
    const isProtected = hasWork || !!ex.manually_edited
    if (fields.length) {
      out.changed.push({ mark_id: p.mark_id, kind: 'changed', parsed: p, existing: ex, hasWork, isProtected, fields })
    } else {
      out.unchanged.push({ mark_id: p.mark_id, kind: 'unchanged', parsed: p, existing: ex, hasWork, isProtected })
    }
  }

  for (const ex of existing) {
    if (!paKeys.has(ex.mark_id.toUpperCase())) {
      const hasWork = markHasWork(ex)
      out.removed.push({ mark_id: ex.mark_id, kind: 'removed', existing: ex, hasWork, isProtected: hasWork || !!ex.manually_edited })
    }
  }
  return out
}

/** True when a re-import has anything a human must resolve (protected change or
 *  any removal) — i.e. it can't be applied cleanly. */
export function needsReview(diff: ImportDiff): boolean {
  return diff.changed.some(d => d.isProtected) || diff.removed.length > 0
}
