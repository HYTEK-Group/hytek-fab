'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AppShell } from '@/components/app-shell'
import { listFabJobs, fetchJobStateMap } from '@/lib/fab'
import { fmtDate, fmtAud } from '@/lib/format'
import { totalBudget } from '@/lib/fab'
import type { FabJob, JobState } from '@/lib/types'

// Ready-to-fab queue — the supervisor's morning view. A job is ready when BOTH
// ss_drawings_issued AND materials_received are true (from Hub flow_jobs, via the
// v1 stub). Excludes jobs already complete / dispatched.
export default function ReadyQueuePage() {
  const [rows, setRows] = useState<Array<{ job: FabJob; state: JobState }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    try {
      setLoading(true)
      const [jobs, stateMap] = await Promise.all([listFabJobs(), fetchJobStateMap()])
      const ready = jobs
        .filter((j) => j.status !== 'complete' && j.status !== 'dispatched')
        .map((j) => ({ job: j, state: j.hubspot_deal_id ? stateMap[j.hubspot_deal_id] : undefined }))
        .filter((r): r is { job: FabJob; state: JobState } =>
          !!r.state && r.state.ss_drawings_issued && r.state.materials_received)
      setRows(ready)
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  const schemaMissing = !!error && /fab_jobs|flow_jobs|relation|does not exist|schema cache/i.test(error)

  return (
    <AppShell>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-hytek-black">Ready to fab</h1>
          <p className="text-sm text-gray-500">
            Drawings issued <span className="text-gray-400">+</span> materials received. Cleared to start on the floor.
          </p>
        </div>

        {schemaMissing && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
            <strong>Schema not applied yet.</strong> Waiting on the gqtikz migration (held for Scott).
          </div>
        )}
        {error && !schemaMissing && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
            <button onClick={load} className="ml-3 underline">Retry</button>
          </div>
        )}

        {loading ? (
          <p className="text-gray-500 text-sm py-8">Loading…</p>
        ) : rows.length === 0 && !error ? (
          <div className="bg-white rounded-xl p-10 text-center border border-gray-200 text-gray-500">
            Nothing ready yet. Jobs appear here once drawings are issued and materials are received.
          </div>
        ) : (
          <div className="grid gap-3">
            {rows.map(({ job }) => (
              <Link
                key={job.id}
                href={`/jobs/${job.id}`}
                className="bg-white rounded-xl border border-gray-200 hover:border-hytek-yellow hover:shadow-sm transition-all p-4 flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <p className="font-medium text-hytek-black truncate">{job.name}</p>
                  <p className="text-xs text-gray-500">
                    {[job.client, job.quote_number].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="flex items-center gap-6 text-sm flex-shrink-0">
                  <div className="text-right hidden sm:block">
                    <div className="text-xs text-gray-400 uppercase">On site</div>
                    <div className="text-gray-700">{fmtDate(job.on_site_date)}</div>
                  </div>
                  <div className="text-right hidden sm:block">
                    <div className="text-xs text-gray-400 uppercase">Budget</div>
                    <div className="tabular-nums text-gray-700">{fmtAud(totalBudget(job))}</div>
                  </div>
                  <span className="text-xs font-bold px-2 py-1 rounded bg-hytek-yellow text-hytek-black">Ready</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}
