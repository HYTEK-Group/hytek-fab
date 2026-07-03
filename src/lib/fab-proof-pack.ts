// Groups the flat proof-photo log into the timeline pack the UI + Troy's app show:
// made → treatment legs (each a package's sent/returned pair) → bundled → loaded.
// PURE (signed URLs are attached by the caller before this) → testable.
import type { ProofStage } from './types'

export interface ProofPhotoView {
  id: string
  stage: ProofStage
  treatment_type: string | null
  fab_mark_id: string | null
  fab_package_id: string | null
  fab_load_id: string | null
  mark_label: string | null // human mark id, e.g. TH1-B1
  url: string | null
  caption: string | null
  taken_by: string
  taken_at: string
}

export interface TreatmentLeg {
  package_id: string | null
  treatment_type: string | null
  contractor_name: string | null
  sent: ProofPhotoView[]     // treatment_out (away)
  returned: ProofPhotoView[] // treatment_in (back)
}

export interface ProofPack {
  made: ProofPhotoView[]
  treatments: TreatmentLeg[]
  bundled: ProofPhotoView[]
  loaded: ProofPhotoView[]
  counts: { made: number; treatment_out: number; treatment_in: number; bundled: number; loaded: number; total: number; marks_photographed: number }
}

const byTime = (a: ProofPhotoView, b: ProofPhotoView) => a.taken_at.localeCompare(b.taken_at)

export function buildProofPack(
  photos: ProofPhotoView[],
  packages: { id: string; treatment_type: string | null; contractor_name: string | null }[] = [],
): ProofPack {
  const pkg = new Map(packages.map(p => [p.id, p]))
  const made = photos.filter(p => p.stage === 'made').sort(byTime)
  const bundled = photos.filter(p => p.stage === 'bundled').sort(byTime)
  const loaded = photos.filter(p => p.stage === 'loaded').sort(byTime)

  // group coating legs by package (fall back to treatment_type when no package id)
  const legKey = (p: ProofPhotoView) => p.fab_package_id ?? `t:${p.treatment_type ?? 'other'}`
  const legs = new Map<string, TreatmentLeg>()
  for (const p of photos) {
    if (p.stage !== 'treatment_out' && p.stage !== 'treatment_in') continue
    const k = legKey(p)
    let leg = legs.get(k)
    if (!leg) {
      const info = p.fab_package_id ? pkg.get(p.fab_package_id) : undefined
      leg = {
        package_id: p.fab_package_id,
        treatment_type: p.treatment_type ?? info?.treatment_type ?? null,
        contractor_name: info?.contractor_name ?? null,
        sent: [], returned: [],
      }
      legs.set(k, leg)
    }
    ;(p.stage === 'treatment_out' ? leg.sent : leg.returned).push(p)
  }
  for (const leg of legs.values()) { leg.sent.sort(byTime); leg.returned.sort(byTime) }
  // order legs by when they first went out (then came back)
  const treatments = [...legs.values()].sort((a, b) =>
    (a.sent[0]?.taken_at ?? a.returned[0]?.taken_at ?? '').localeCompare(b.sent[0]?.taken_at ?? b.returned[0]?.taken_at ?? ''))

  const marksPhotographed = new Set(made.map(p => p.fab_mark_id).filter(Boolean)).size

  return {
    made, treatments, bundled, loaded,
    counts: {
      made: made.length,
      treatment_out: photos.filter(p => p.stage === 'treatment_out').length,
      treatment_in: photos.filter(p => p.stage === 'treatment_in').length,
      bundled: bundled.length,
      loaded: loaded.length,
      total: photos.length,
      marks_photographed: marksPhotographed,
    },
  }
}
