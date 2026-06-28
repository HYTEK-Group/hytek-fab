# HYTEK Fab — SS ingest from detailing (Tekla IFF reports) — design

**Date:** 2026-06-28
**Status:** approved (design). Fab-side build.
**Companions (other sessions):** Desktop `HYTEK-Detailing-Release-to-Factory-REQUIREMENT-2026-06-28.md`, `HYTEK-Hub-SS-Release-Pipeline-HANDOVER-2026-06-28.md`, `HYTEK-Purchasing-SS-BOM-HANDOVER-2026-06-28.md`. Cross-app map: `reference_hytek_cross_app_handoff_map`.

## Goal

When detailing **releases a job to the factory** (SS), the structural-steel data flows automatically
from the Tekla "Issued For Fabrication" (IFF) reports into the fab app — every mark with its weight, the
total tonnage, the drawings, and a bill of materials for purchasing — with re-issues detected and
**never silently overwriting in-progress fabrication work**.

## Locked decisions

1. Release button lives in the **detailing app** (separate requirement doc).
2. The fab Y: bridge writes a shared **`job_bom`** table that **purchasing reads** (one parser).
3. Re-issue **never auto-changes a mark that has work against it**; "removed but already fabricated" is
   surfaced, never deleted.
4. Release **warns** if internal review incomplete — does not hard-block.

## Data source (verified on HG260012)

`Y:\(NN) <YEAR> HYTEK PROJECTS\<customer>\<job no ...>\06 MANUFACTURING\02 DRAWINGS MANUFACTURING\02 STRUCTURAL\<block>\REPORTS\`
— one set per building block (e.g. TH1&2, TH3&4). Job number (`HG260012`) is in every filename and inside
each sheet (`Project Number`).

**Assembly List** (→ fab marks). Header row begins `Assembly Mark`; 2-row header; data below:
`Assembly Mark | Qty | Profile | Name | Length (mm) | Assembly Weight (kg) for one | … for all | Area one | Area all | Assembly Coating`
e.g. `TH1-B1 | 1 | PFC150*75 | BEAM | 4340 | 85.1 | 85.1 | … | ETCH PRIMER`.

**For the BOM** (→ purchasing): Part Material List (raw sections "For Ordering"), Plate Part List, Bolt
Summary + Erection Bolt List, Chemset Tube Summary, Loose Plate List, Miscellaneous List.

**Drawings:** the PDFs (ASSEMBLIES / PLATES / SHAFTS + per-report PDFs).

Proof: HG260012 parsed = 65 assemblies, 4.64 t, sections + coatings, with no manual entry.

## Mark mapping (Assembly List → `fab_marks`)

| fab_marks | from Assembly List |
|---|---|
| `mark_id` | Assembly Mark (e.g. `TH1-B1`) |
| `section` | Profile (e.g. `PFC150*75`) |
| `description` | Name (e.g. `BEAM`) |
| `length_mm` | Length (mm) |
| `weight_kg` | Assembly Weight (kg) **for one** |
| `quantity` | Qty |
| (coating) | Assembly Coating → drives the treatment package (see below) |

Total job tonnage = Σ(`weight_kg` × `quantity`) — feeds the tonnage-weighted progress + report already
built, and `flow_fab_progress.tonnes_total/tonnes_complete` for the Hub.

## Architecture (units)

- `src/lib/tekla-assembly.ts` — **pure** parser: xlsx rows → `{ marks: ParsedMark[], tonnage, issue, block }`.
  Finds the header row dynamically, skips the title block, tolerates Tekla's special chars. Tested against
  a real HG260012 fixture.
- `src/lib/tekla-bom.ts` — **pure** parser: the material/plate/bolt/chemset reports → `BomLine[]`
  (category, profile/spec, grade, length, qty, weight, from_stock/from_order).
- `src/lib/fab-import.ts` — **pure** reconcile: given parsed marks + existing marks, produce an
  import diff `{ added, changed, removed, unchanged }`, flagging which changed/removed marks have work
  against them (status ≠ not_started, time logged, in a package/load, or `manually_edited`).
- `src/app/api/fab/jobs/[id]/import-assembly/route.ts` — POST: accept an uploaded Assembly List xlsx
  (Phase 1 manual path), parse, reconcile, apply per the rules, stamp provenance.
- `scripts/ss-ingest-bridge.mjs` — the **server-side Y: sync** (Phase 2; the LWS pattern). Scans released
  jobs' `…/02 STRUCTURAL/**/REPORTS`, parses, calls the same apply logic via service role, writes the BOM
  + uploads PDFs. Runs on the always-on server (Vercel can't reach Y:).

## Provenance + schema (migration `004-fab-ss-ingest.sql`, gqtikz)

`fab_marks` additive columns:
- `source` text — `'manual'|'auto'|null` (null = hand-created)
- `source_issue` integer — the release version the mark came from
- `source_file` text, `source_hash` text — what produced it
- `manually_edited` boolean default false — set when a human edits an imported mark
- `cut_length_mm` integer null — net cut length if different from member length (future)

New tables (RLS: service-role write, authenticated read):
- `fab_import_batches` — `id, fab_job_id, quote_number, stream='SS', issue_version, block, source_file,
  source_hash, parsed_marks int, total_kg numeric, status ('pending_review'|'applied'|'superseded'),
  imported_by, created_at`. One row per imported report set.
- `job_bom` — `id, quote_number, hubspot_deal_id, issue_version, category ('section'|'plate'|'bolt'|
  'chemset'|'loose'|'misc'), part_mark, profile, grade, length_mm, qty, weight_kg, from_stock, from_order,
  source_file, created_at`. **Purchasing reads this.**
- `flow_fab_progress` ADD `tonnes_total numeric`, `tonnes_complete numeric` (the Hub's open "Part A";
  Hub auto-upgrades to tonnes once present).

## Apply rules (first import + re-issue)

**First import (no existing marks):** create every mark, `source='auto'|'manual'`, `source_issue=N`. Done.

**Re-issue (a newer `issue_version` / changed `source_hash` for a job already imported):**
1. Parse → reconcile vs current marks → diff.
2. Write a `fab_import_batches` row `status='pending_review'`. **Do not auto-apply.**
3. Flag the job: "New SS issue N — review" (supervisor banner + needs-attention).
4. Auto-applicable safely: **added** marks (new work) may be created immediately (configurable; default:
   include them in the review set so the supervisor sees the whole change at once).
5. **Changed** marks: if the mark has **no work** against it and is **not** `manually_edited` → update in
   place. If it **has work** or is hand-edited → **never auto-change**; list it for the supervisor to
   resolve (keep + note, or reset).
6. **Removed** marks: never delete. If not started → mark cancelled/archived. If **already fabricated** →
   surface as a real cost issue for the supervisor (and notify purchasing).
7. Supervisor reviews + accepts → changes apply, batch `status='applied'`, audit row written; the previous
   batch → `superseded`.
8. Purchasing is notified of the BOM change (its own re-issue handling — see its handover).

A **manually-edited** mark is protected from all future auto-overwrites (conflicts are surfaced, not applied).

## Treatment from coating

The Assembly List `Coating` (e.g. `ETCH PRIMER`, `DURAGAL OR SIMILAR`, HDG/galv) maps to a treatment
package: on import, group marks by coating and pre-create a `fab_contractor_packages`
(`package_type='treatment'`, `treatment_type` mapped from the coating text) with those marks — supervisor
confirms/sends. Unknown coating → leave unassigned + flag.

## Trigger

- **Phase 1 (now):** manual — supervisor uploads the Assembly List xlsx in the fab app. Immediate value,
  proves the parser, no server dependency.
- **Phase 2:** automatic — the Y: bridge fires when the Hub job-state shows `ss_release` (version N) for a
  job (the detailing "Release to Factory"). Re-release (N+1) → the re-issue flow above.

## Phasing

- **P1 (this build):** `tekla-assembly.ts` parser + tests (real fixture) · migration 004 (provenance +
  `fab_import_batches` + `flow_fab_progress` tonnes) · manual `import-assembly` endpoint + a small import
  UI on the job page · populate `flow_fab_progress` tonnes on import · coating→treatment.
- **P2:** the Y: sync bridge (server) + Hub `ss_release` trigger consumption + full re-issue review UI.
- **P3:** `tekla-bom.ts` + `job_bom` write + purchasing reads it.

## Test plan

- `tekla-assembly.test.ts`: real HG260012 fixture → 65 marks, 4.64 t; header detection; special chars;
  qty×weight; coating extracted; multi-block.
- `fab-import.test.ts`: added/changed/removed diff; worked-mark protection; manually-edited protection;
  removed-but-fabricated surfaced.
- `tekla-bom.test.ts`: each report type → BomLine rows.

## Out of scope (YAGNI)
- Reading weights off the PDF (we read the structured xlsx).
- Purchasing's PO creation (their session) — we only write `job_bom`.
- The detailing release action + Hub recording (their sessions) — we consume the signal.
