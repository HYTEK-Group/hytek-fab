'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AppShell } from '@/components/app-shell'
import { listFabJobs, totalBudget, marginDollars, STATUS_LABEL } from '@/lib/fab'
import { fmtDate, fmtAud } from '@/lib/format'
import type { FabJob, FabStatus } from '@/lib/types'

const STATUS_STYLES: Record<FabStatus, string> = {
  pending: 'bg-gray-100 text-gray-700',
  ready: 'bg-hytek-yellow text-hytek-black',
  in_progress: 'bg-blue-100 text-blue-700',
  complete: 'bg-green-100 text-green-700',
  dispatched: 'bg-gray-800 text-white',
}

export default function JobRegisterPage() {
  // All useState before any conditional return (React hooks rule).
  const [jobs, setJobs] = useState<FabJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'active' | 'all'>('active')

  useEffect(() => {
    load()
  }, [])

  async function load() {
    try {
      setLoading(true)
      const data = await listFabJobs()
      setJobs(data)
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load jobs')
    } finally {
      setLoading(false)
    }
  }

  const q = search.toLowerCase()
  const filtered = jobs.filter((j) => {
    const matchesSearch =
      !q ||
      j.name.toLowerCase().includes(q) ||
      (j.client || '').toLowerCase().includes(q) ||
      (j.quote_number || '').toLowerCase().includes(q)
    const matchesStatus =
      statusFilter === 'all' || (j.status !== 'complete' && j.status !== 'dispatched')
    return matchesSearch && matchesStatus
  })

  // Schema not applied yet → friendly hint instead of a raw Postgres error.
  const schemaMissing = !!error && /fab_jobs|relation|does not exist|schema cache/i.test(error)

  return (
    <AppShell>
      <div className="space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold text-hytek-black">Fabrication jobs</h1>
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              {(['active', 'all'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-md capitalize ${
                    statusFilter === f ? 'bg-white text-hytek-black shadow-sm' : 'text-gray-500'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          <input
            type="search"
            placeholder="Search jobs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="!w-64"
          />
        </div>

        {schemaMissing && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
            <strong>Schema not applied yet.</strong> The <code>fab_jobs</code> table doesn&apos;t
            exist in gqtikz. The migration is held for Scott (shared-DB, stop-and-coordinate). See
            <code> sql/001-fab-schema.sql</code>.
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
        ) : filtered.length === 0 && !error ? (
          <div className="bg-white rounded-xl p-10 text-center border border-gray-200 text-gray-500">
            No jobs yet. Jobs arrive from Hub on import.
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
                  <th className="px-4 py-3">Job</th>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">On site</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Award</th>
                  <th className="px-4 py-3 text-right">Budget</th>
                  <th className="px-4 py-3 text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((j) => {
                  const margin = marginDollars(j)
                  return (
                    <tr key={j.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link href={`/jobs/${j.id}`} className="font-medium text-hytek-black hover:underline">
                          {j.name}
                        </Link>
                        <div className="text-xs text-gray-500">{j.quote_number}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{j.client || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{fmtDate(j.on_site_date)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-bold px-2 py-1 rounded ${STATUS_STYLES[j.status]}`}>
                          {STATUS_LABEL[j.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtAud(j.award_price_excl_gst)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtAud(totalBudget(j))}</td>
                      <td className={`px-4 py-3 text-right tabular-nums font-medium ${margin < 0 ? 'text-red-600' : 'text-green-700'}`}>
                        {fmtAud(margin)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  )
}
