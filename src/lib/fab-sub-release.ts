// The drop-ship release gate — the ONE place that decides whether steel a
// subcontractor made can go straight to site WITHOUT in-house QC. PURE (no DB)
// → testable. The route gathers the facts; this function is the law:
//   • package must be a drop-ship fabrication package, not already released
//   • the sub must have declared it ready (ready_at)
//   • every piece must have a 'made' proof photo (the completion evidence)
//   • at least one QA/mill cert must be attached (tamper-locked)
//   • CC3/CC4 jobs may NEVER drop-ship (in-house inspection is law) — this fails
//     CLOSED regardless of the compliance_mode flag, so a mis-set row can't leak
//     high-consequence steel past QC
import type { CcLevel, ComplianceMode, DeliveryMode } from '@/lib/types'

export interface DropShipFacts {
  package_type: string
  delivery_mode: DeliveryMode
  drop_ship_released_at: string | null
  ready_at: string | null
  total_marks: number
  marks_with_made_photo: number
  cert_count: number
  cc_level: CcLevel | null
  compliance_mode: ComplianceMode
}

export interface DropShipVerdict {
  ok: boolean
  /** Human reasons the release is blocked (empty when ok). */
  blockers: string[]
}

export function canReleaseDropShip(f: DropShipFacts): DropShipVerdict {
  const blockers: string[] = []

  if (f.package_type !== 'fabrication') {
    blockers.push('Only fabrication packages can be drop-ship released')
  }
  if (f.delivery_mode !== 'drop_ship') {
    blockers.push('Package is not a drop-ship package — it returns to Brisbane for QC')
  }
  if (f.drop_ship_released_at) {
    blockers.push('Already released for drop-ship')
  }
  // Fail CLOSED for high-consequence classes: block whenever the job is CC3/CC4,
  // independent of the compliance_mode flag (which defaults to 'permissive' and
  // may never have been escalated). In-house inspection is not negotiable here.
  if (f.cc_level === 'CC3' || f.cc_level === 'CC4') {
    blockers.push(`${f.cc_level} steel requires in-house inspection — drop-ship is not allowed`)
  }
  if (!f.ready_at) {
    blockers.push('Sub has not marked the package ready to collect')
  }
  if (f.total_marks === 0) {
    blockers.push('Package has no pieces')
  } else if (f.marks_with_made_photo < f.total_marks) {
    blockers.push(`Only ${f.marks_with_made_photo} of ${f.total_marks} pieces have a made photo`)
  }
  if (f.cert_count === 0) {
    blockers.push('No QA / mill certs attached — required before un-inspected steel can ship')
  }

  return { ok: blockers.length === 0, blockers }
}
