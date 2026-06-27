// Hub progress feed. computeProgressRow() is pure (testable, no DB).
// computeAndUpsertProgress() fetches rows and upserts flow_fab_progress.
import { getSupabaseAdmin } from './supabase-admin'
import { buildNarrative } from './fab-narrative'
import type {
  FabMark, FabContractorPackage, FabContractorUpdate, FabDispatchLoad,
  FabProgressRow, FabProgressPackageSummary, FabProgressLoadSummary, FabProgressStatus,
} from './types'

export interface ProgressJobMeta {
  fab_job_id: string
  quote_number: string
  hubspot_deal_id: string | null
  on_site_date: string | null
}

export function computeProgressRow(
  job: ProgressJobMeta,
  marks: FabMark[],
  packages: FabContractorPackage[],
  updates: FabContractorUpdate[],
  loads: FabDispatchLoad[],
  today: string,
): FabProgressRow {
  const total = marks.length
  const qcPassed = marks.filter(m => m.status === 'qc_passed')
  const pct = total === 0 ? 0 : Math.round((qcPassed.length / total) * 100)

  const inhouse = marks.filter(m => !m.contractor_package_id)
  const inhouseComplete = inhouse.filter(
    m => m.status === 'done' || m.status === 'qc_passed',
  ).length

  const reworkTotal = marks.filter(m => m.rework_count > 0).length

  const updatesByPkg = new Map<string, FabContractorUpdate[]>()
  for (const u of updates) {
    const arr = updatesByPkg.get(u.package_id) ?? []
    arr.push(u)
    updatesByPkg.set(u.package_id, arr)
  }
  const packageSummaries: FabProgressPackageSummary[] = packages.map(pkg => {
    const pkgMarks = marks.filter(m => m.contractor_package_id === pkg.id)
    const done = pkgMarks.filter(
      m => m.status === 'returned' || m.status === 'qc_passed' || m.status === 'done',
    ).length
    const pkgUpdates = (updatesByPkg.get(pkg.id) ?? [])
      .slice()
      .sort((a, b) => a.logged_at.localeCompare(b.logged_at))
    const latest = pkgUpdates[pkgUpdates.length - 1] ?? null
    return {
      package_id: pkg.id,
      package_type: pkg.package_type,
      treatment_type: pkg.treatment_type,
      contractor_name: pkg.contractor_name,
      scope_note: pkg.scope_note,
      total_marks: pkgMarks.length,
      marks_done: done,
      pct: pkgMarks.length === 0 ? 0 : Math.round((done / pkgMarks.length) * 100),
      status: pkg.status,
      last_update_date: latest?.logged_at ?? null,
      last_update_note: latest?.note ?? null,
      expected_return_date: pkg.expected_return_date,
      returned_at: pkg.returned_at,
    }
  })

  const dispatchedLoadIds = new Set(loads.filter(l => l.dispatched_at).map(l => l.id))
  const marksDispatched = marks.filter(
    m => m.dispatch_load_id && dispatchedLoadIds.has(m.dispatch_load_id),
  ).length
  const loadSummaries: FabProgressLoadSummary[] = loads
    .slice()
    .sort((a, b) => a.load_number - b.load_number)
    .map(l => ({
      load_number: l.load_number,
      description: l.description,
      total_marks: marks.filter(m => m.dispatch_load_id === l.id).length,
      dispatched_at: l.dispatched_at,
      planned_date: l.planned_date,
    }))

  let status: FabProgressStatus = 'in_progress'
  if (total > 0) {
    const allDispatched = marks.every(
      m => m.dispatch_load_id && dispatchedLoadIds.has(m.dispatch_load_id),
    )
    const allQcPassed = qcPassed.length === total
    if (allDispatched) status = 'dispatched'
    else if (allQcPassed) status = 'dispatch_ready'
    else status = 'in_progress'
  }

  const base: Omit<FabProgressRow, 'narrative'> = {
    fab_job_id: job.fab_job_id,
    quote_number: job.quote_number,
    hubspot_deal_id: job.hubspot_deal_id,
    total_marks: total,
    marks_qc_passed: qcPassed.length,
    marks_dispatched: marksDispatched,
    pct_complete: pct,
    inhouse_total: inhouse.length,
    inhouse_complete: inhouseComplete,
    rework_total: reworkTotal,
    contractor_packages: packageSummaries,
    dispatch_loads: loadSummaries,
    status,
  }

  const narrative = buildNarrative({ ...base, on_site_date: job.on_site_date }, today)
  return { ...base, narrative }
}

export async function computeAndUpsertProgress(fabJobId: string): Promise<void> {
  const admin = getSupabaseAdmin()

  const { data: jobRow } = await admin
    .from('fab_jobs')
    .select('id, quote_number, hubspot_deal_id, on_site_date')
    .eq('id', fabJobId)
    .single()
  if (!jobRow) return

  const [{ data: marks }, { data: packages }, { data: loads }] = await Promise.all([
    admin.from('fab_marks').select('*').eq('fab_job_id', fabJobId),
    admin.from('fab_contractor_packages').select('*').eq('fab_job_id', fabJobId),
    admin.from('fab_dispatch_loads').select('*').eq('fab_job_id', fabJobId),
  ])

  const pkgIds = (packages ?? []).map(p => p.id)
  let updates: FabContractorUpdate[] = []
  if (pkgIds.length > 0) {
    const { data } = await admin
      .from('fab_contractor_updates')
      .select('*')
      .in('package_id', pkgIds)
    updates = (data as FabContractorUpdate[]) ?? []
  }

  const today = new Date().toISOString().slice(0, 10)
  const row = computeProgressRow(
    {
      fab_job_id: jobRow.id,
      quote_number: jobRow.quote_number,
      hubspot_deal_id: jobRow.hubspot_deal_id,
      on_site_date: jobRow.on_site_date,
    },
    (marks as FabMark[]) ?? [],
    (packages as FabContractorPackage[]) ?? [],
    updates,
    (loads as FabDispatchLoad[]) ?? [],
    today,
  )

  await admin
    .from('flow_fab_progress')
    .upsert(
      { ...row, updated_at: new Date().toISOString() },
      { onConflict: 'fab_job_id' },
    )
}
