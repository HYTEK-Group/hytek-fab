'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { AppShell } from '@/components/app-shell'
import { getFabJob, totalBudget, marginDollars, STATUS_LABEL, BUDGET_CODES } from '@/lib/fab'
import { fmtDate, fmtAud } from '@/lib/format'
import type { FabJob } from '@/lib/types'

type Tab = 'overview' | 'budget'
const WEEK2_TABS = ['Marks', 'Sub packages', 'Surface treatment'] as const

export default function JobDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id

  const [job, setJob] = useState<FabJob | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('overview')

  useEffect(() => {
    if (!id) return
    ;(async () => {
      try {
        setLoading(true)
        setJob(await getFabJob(id))
        setError(null)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to load job')
      } finally {
        setLoading(false)
      }
    })()
  }, [id])

  return (
    <AppShell>
      <Link href="/" className="text-sm text-gray-500 hover:text-gray-700">← Back to jobs</Link>

      {loading ? (
        <p className="text-gray-500 text-sm py-8">Loading…</p>
      ) : error ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 mt-4">
          {/fab_jobs|relation|does not exist|schema cache/i.test(error)
            ? 'Schema not applied yet — the migration is held for Scott (sql/001-fab-schema.sql).'
            : error}
        </div>
      ) : !job ? (
        <p className="text-gray-500 text-sm py-8">Job not found.</p>
      ) : (
        <>
          <div className="flex items-start justify-between gap-4 flex-wrap mt-1 mb-5">
            <div>
              <h1 className="text-2xl font-bold text-hytek-black">{job.name}</h1>
              <p className="text-sm text-gray-500">
                {[job.client, job.quote_number, job.cc_level].filter(Boolean).join(' · ')}
              </p>
            </div>
            <span className="text-xs font-bold px-2 py-1 rounded bg-hytek-yellow text-hytek-black self-start">
              {STATUS_LABEL[job.status]}
            </span>
          </div>

          <div className="flex gap-1 border-b border-gray-200 mb-5 flex-wrap">
            {(['overview', 'budget'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px ${
                  tab === t ? 'border-hytek-yellow text-hytek-black' : 'border-transparent text-gray-500'
                }`}
              >
                {t}
              </button>
            ))}
            {WEEK2_TABS.map((t) => (
              <span key={t} className="px-4 py-2 text-sm text-gray-300" title="Week 2">{t}</span>
            ))}
          </div>

          {tab === 'overview' && (
            <div className="grid sm:grid-cols-2 gap-3 max-w-2xl">
              <Field label="On-site date" value={fmtDate(job.on_site_date)} />
              <Field label="Construction category" value={job.cc_level || '—'} />
              <Field label="Award (excl GST)" value={fmtAud(job.award_price_excl_gst)} />
              <Field label="Total budget" value={fmtAud(totalBudget(job))} />
              <Field
                label="Margin"
                value={fmtAud(marginDollars(job))}
                tone={marginDollars(job) < 0 ? 'bad' : 'good'}
              />
              <Field label="Compliance mode" value={job.compliance_mode} />
            </div>
          )}

          {tab === 'budget' && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto max-w-2xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
                    <th className="px-4 py-3">Code</th>
                    <th className="px-4 py-3">Cost code</th>
                    <th className="px-4 py-3 text-right">Budget</th>
                  </tr>
                </thead>
                <tbody>
                  {BUDGET_CODES.map((c) => (
                    <tr key={c.code} className="border-b border-gray-100">
                      <td className="px-4 py-2.5 text-gray-400 tabular-nums">{c.code}</td>
                      <td className="px-4 py-2.5">{c.label}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {fmtAud(Number(job[c.field as keyof FabJob]) || 0)}
                      </td>
                    </tr>
                  ))}
                  <tr className="font-medium">
                    <td className="px-4 py-3" colSpan={2}>Total budget</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtAud(totalBudget(job))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </AppShell>
  )
}

function Field({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div
        className={`text-base font-medium ${
          tone === 'bad' ? 'text-red-600' : tone === 'good' ? 'text-green-700' : 'text-hytek-black'
        }`}
      >
        {value}
      </div>
    </div>
  )
}
