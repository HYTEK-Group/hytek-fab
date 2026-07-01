'use client'

// Job tonnage & time report — every job with total tonnage, hours logged, and
// the achieved rate (made tonnes ÷ hours). Reads /api/fab/jobs (which already
// rolls up mark weights + the job time log). Export to CSV for off-app use.
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { AppShell } from '@/components/app-shell'
import { supabase } from '@/lib/supabase'
import { kgToTonnes } from '@/lib/fab-tonnage'
import type { FabJob } from '@/lib/types'

interface Row extends FabJob {
  total_hours: number
  total_kg: number
  made_kg: number
  tonnage_pct: number
  marks_missing_weight: number
}

function rate(madeKg: number, hours: number): number | null {
  if (!hours || hours <= 0) return null
  return Math.round((kgToTonnes(madeKg) / hours) * 100) / 100
}

export default function ReportPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [jobs, setJobs] = useState<Row[]>([])
  const [fetching, setFetching] = useState(true)

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const res = await fetch('/api/fab/jobs', { headers: { Authorization: `Bearer ${session.access_token}` } })
    if (res.ok) setJobs((await res.json()).jobs ?? [])
    setFetching(false)
  }, [])

  useEffect(() => { if (!loading && !user) router.push('/login') }, [user, loading, router])
  useEffect(() => { if (user) load() }, [user, load])

  if (loading || !user) return null

  const totals = jobs.reduce(
    (a, j) => ({ kg: a.kg + j.total_kg, made: a.made + j.made_kg, hrs: a.hrs + (j.total_hours ?? 0) }),
    { kg: 0, made: 0, hrs: 0 },
  )

  function exportCsv() {
    const head = ['Quote', 'Name', 'Client', 'Status', 'Total tonnes', 'Made tonnes', '% by tonnage', 'Hours', 't/hr']
    const lines = jobs.map(j => [
      j.quote_number, j.name, j.client ?? '', j.status,
      kgToTonnes(j.total_kg), kgToTonnes(j.made_kg), j.tonnage_pct,
      (j.total_hours ?? 0).toFixed(1), rate(j.made_kg, j.total_hours) ?? '',
    ])
    lines.push([
      'TOTAL', '', '', '', kgToTonnes(totals.kg), kgToTonnes(totals.made), '',
      totals.hrs.toFixed(1), rate(totals.made, totals.hrs) ?? '',
    ])
    const csv = [head, ...lines]
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fab-tonnage-time-report.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const cell: React.CSSProperties = { padding: '8px 10px', borderBottom: '0.5px solid var(--border)', whiteSpace: 'nowrap' }
  const head: React.CSSProperties = { ...cell, color: 'var(--text-3)', textAlign: 'right', fontWeight: 600, position: 'sticky', top: 0, background: 'var(--surface-2)' }
  const num: React.CSSProperties = { ...cell, textAlign: 'right', color: 'var(--foreground)' }

  return (
    <AppShell>
      <div className="p-4 max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-lg font-semibold" style={{ color: 'var(--foreground)', fontWeight: 700 }}>Tonnage &amp; time report</h1>
          <button onClick={exportCsv} className="text-xs px-3 py-1.5 rounded-lg font-medium"
            style={{ background: 'var(--hytek-yellow)', color: 'var(--on-brand)', border: 'none' }}>
            Export CSV
          </button>
        </div>

        <p className="text-xs mb-3" style={{ color: 'var(--text-2)' }}>
          Every job — total tonnage (mark weights), hours logged (job time log), and achieved rate (made tonnes ÷ hours). In-house time only.
        </p>

        {fetching && <p className="text-sm" style={{ color: 'var(--text-2)' }}>Loading…</p>}
        {!fetching && jobs.length === 0 && <p className="text-sm" style={{ color: 'var(--text-2)' }}>No jobs yet.</p>}

        {jobs.length > 0 && (
          <div className="overflow-x-auto rounded-xl" style={{ border: '0.5px solid var(--border)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ ...head, textAlign: 'left' }}>Job</th>
                  <th style={{ ...head, textAlign: 'left' }}>Status</th>
                  <th style={head}>Total t</th>
                  <th style={head}>Made t</th>
                  <th style={head}>%</th>
                  <th style={head}>Hours</th>
                  <th style={head}>t / hr</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map(j => {
                  const r = rate(j.made_kg, j.total_hours)
                  return (
                    <tr key={j.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/jobs/${j.id}`)}>
                      <td style={{ ...cell, color: 'var(--foreground)' }}>
                        <span style={{ color: 'var(--foreground)', fontWeight: 700 }}>{j.quote_number}</span> {j.name}
                        {j.marks_missing_weight > 0 && (
                          <span style={{ color: 'var(--warning)' }}> · {j.marks_missing_weight} no wt</span>
                        )}
                      </td>
                      <td style={{ ...cell, color: 'var(--text-3)' }}>{j.status}</td>
                      <td style={num}>{kgToTonnes(j.total_kg)}</td>
                      <td style={num}>{kgToTonnes(j.made_kg)}</td>
                      <td style={{ ...num, color: 'var(--foreground)', fontWeight: 700 }}>{j.tonnage_pct}%</td>
                      <td style={num}>{(j.total_hours ?? 0).toFixed(1)}</td>
                      <td style={num}>{r ?? '—'}</td>
                    </tr>
                  )
                })}
                <tr style={{ background: 'var(--surface)' }}>
                  <td style={{ ...cell, color: 'var(--foreground)', fontWeight: 700 }}>All jobs</td>
                  <td style={cell}></td>
                  <td style={{ ...num, fontWeight: 700 }}>{kgToTonnes(totals.kg)}</td>
                  <td style={{ ...num, fontWeight: 700 }}>{kgToTonnes(totals.made)}</td>
                  <td style={cell}></td>
                  <td style={{ ...num, fontWeight: 700 }}>{totals.hrs.toFixed(1)}</td>
                  <td style={{ ...num, fontWeight: 700 }}>{rate(totals.made, totals.hrs) ?? '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  )
}
