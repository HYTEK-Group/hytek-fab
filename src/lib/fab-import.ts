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
  source_file?: string | null
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

// `existing` should be ALL of the job's marks (so a parsed mark that collides
// with a hand-entered or other-source mark is treated as a CHANGE — and thus
// protected — not a fresh add that silently overwrites). `sourceKey` scopes the
// "removed" detection to marks from the same report being re-imported; pass
// undefined to treat every existing mark as in scope.
export function diffMarks(parsed: ParsedMark[], existing: ExistingMark[], sourceKey?: string): ImportDiff {
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
    if (paKeys.has(ex.mark_id.toUpperCase())) continue
    // Only flag as removed if this mark came from the report being re-imported.
    if (sourceKey !== undefined && (ex.source_file ?? null) !== sourceKey) continue
    const hasWork = markHasWork(ex)
    out.removed.push({ mark_id: ex.mark_id, kind: 'removed', existing: ex, hasWork, isProtected: hasWork || !!ex.manually_edited })
  }
  return out
}

/** True when a re-import has anything a human must resolve (protected change or
 *  any removal) — i.e. it can't be applied cleanly. */
export function needsReview(diff: ImportDiff): boolean {
  return diff.changed.some(d => d.isProtected) || diff.removed.length > 0
}

/** Upsert options for the fab_marks import write. defaultToNull MUST stay false:
 *  the batch mixes added rows (which set status) with changed rows (which omit
 *  it — a respec'd mark keeps its DB status). With supabase-js's default
 *  (defaultToNull: true) the changed rows go up as status: null and the
 *  ON CONFLICT UPDATE path violates fab_marks.status NOT NULL — the WHOLE import
 *  500s whenever one re-issue both adds a mark and respecs a clean one. With
 *  false, an omitted column takes its column DEFAULT ('not_started'), a no-op
 *  here because every non-protected changed mark is 'not_started' by definition
 *  (markHasWork counts any other status as work → protected → skipped). */
export const MARK_UPSERT_OPTIONS = { onConflict: 'fab_job_id,mark_id', defaultToNull: false } as const

/** Build the fab_marks upsert rows for a diff: adds (status stamped) + clean
 *  respecs (status omitted — preserved via MARK_UPSERT_OPTIONS). Pure, testable. */
export function buildMarkUpserts(
  diff: ImportDiff,
  meta: { fabJobId: string; version: number; sourceKey: string; sourceHash: string },
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []
  for (const d of diff.added) {
    const p = d.parsed!
    rows.push({
      fab_job_id: meta.fabJobId, mark_id: p.mark_id.toUpperCase(), description: p.description, section: p.section,
      length_mm: p.length_mm, weight_kg: p.weight_kg, quantity: p.quantity, coating: p.coating,
      status: 'not_started', source: 'import', source_issue: meta.version, source_file: meta.sourceKey, source_hash: meta.sourceHash,
    })
  }
  for (const d of diff.changed) {
    if (d.isProtected) continue
    const p = d.parsed!
    rows.push({
      fab_job_id: meta.fabJobId, mark_id: p.mark_id.toUpperCase(), description: p.description, section: p.section,
      length_mm: p.length_mm, weight_kg: p.weight_kg, quantity: p.quantity, coating: p.coating,
      source: 'import', source_issue: meta.version, source_file: meta.sourceKey, source_hash: meta.sourceHash,
    })
  }
  return rows
}
