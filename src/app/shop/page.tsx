'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { AppShell } from '@/components/app-shell'
import { supabase } from '@/lib/supabase'
import { kgToTonnes } from '@/lib/fab-tonnage'
import type { FabJob } from '@/lib/types'

interface JobSummary extends FabJob {
  task_count: number
  task_done: number
  mark_count: number
  mark_done: number
  total_hours: number
  has_active_packages: boolean
  total_kg: number
  made_kg: number
  tonnage_pct: number
  marks_missing_weight: number
}

function statusBadge(j: JobSummary) {
  if (j.status === 'complete' || j.dispatch_requested_at)
    return { label: 'Dispatch ready', color: 'var(--success)', bg: 'var(--chip-success-bg)' }
  if (j.has_active_packages)
    return { label: 'At contractor', color: 'var(--info)', bg: 'var(--chip-info-bg)' }
  return { label: 'In progress', color: 'var(--on-brand)', bg: 'var(--chip-brand-bg)' }
}

export default function ShopPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [jobs, setJobs] = useState<JobSummary[]>([])
  const [fetching, setFetching] = useState(true)

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const res = await fetch('/api/fab/jobs', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    if (res.ok) {
      const json = await res.json()
      setJobs(json.jobs ?? [])
    }
    setFetching(false)
  }, [])

  useEffect(() => {
    if (!loading && !user) router.push('/login')
  }, [user, loading, router])

  useEffect(() => { if (user) load() }, [user, load])

  if (loading || !user) return null

  const active = jobs.filter(j => j.status === 'in_progress' && !j.dispatch_requested_at)
  const dispatchReady = jobs.filter(j => j.dispatch_requested_at && j.status !== 'dispatched')

  return (
    <AppShell>
      <div className="p-4 max-w-2xl mx-auto">
        {/* Stat strip */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[
            { label: 'Active jobs', value: active.length },
            { label: 'Dispatch ready', value: dispatchReady.length, highlight: dispatchReady.length > 0 },
            { label: 'Total tonnes (all)', value: kgToTonnes(jobs.reduce((s, j) => s + j.total_kg, 0)).toFixed(1) },
          ].map(s => (
            <div key={s.label} className="rounded-xl p-3" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
              <p className="text-xs mb-1" style={{ color: 'var(--text-2)' }}>{s.label}</p>
              <p className="text-xl font-medium" style={{ color: s.highlight ? 'var(--success)' : 'var(--foreground)' }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Alerts */}
        {dispatchReady.length > 0 && (
          <div className="rounded-xl p-3 mb-4 flex gap-2" style={{ background: 'var(--chip-success-bg)', border: '0.5px solid var(--success)' }}>
            <span style={{ color: 'var(--success)' }}>✓</span>
            <p className="text-sm" style={{ color: 'var(--success)' }}>
              <strong style={{ color: 'var(--foreground)' }}>{dispatchReady.map(j => j.name).join(', ')}</strong> — fab complete, dispatch alerted
            </p>
          </div>
        )}

        {/* Jobs */}
        <p className="text-xs mb-2" style={{ color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '.07em' }}>
          {fetching ? 'Loading…' : `${active.length} active job${active.length !== 1 ? 's' : ''}`}
        </p>

        {jobs.length === 0 && !fetching && (
          <div className="rounded-xl p-6 text-center" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
            <p style={{ color: 'var(--text-2)' }}>No active fab jobs. Check the Ready queue.</p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {jobs.map(job => {
            const badge = statusBadge(job)
            const pct = job.tonnage_pct
            return (
              <button
                key={job.id}
                onClick={() => router.push(`/jobs/${job.id}`)}
                className="rounded-xl p-3 text-left w-full"
                style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}
              >
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-medium" style={{ color: 'var(--foreground)', fontWeight: 700 }}>{job.quote_number}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: badge.bg, color: badge.color }}>{badge.label}</span>
                </div>
                <p className="text-sm font-medium mb-0.5 truncate" style={{ color: 'var(--foreground)' }}>{job.name}</p>
                <p className="text-xs mb-2 truncate" style={{ color: 'var(--text-2)' }}>{job.client ?? '—'}</p>
                <div className="rounded-full h-1 mb-1" style={{ background: 'var(--track)' }}>
                  <div className="h-full rounded-full" style={{ background: 'var(--hytek-yellow)', width: `${pct}%` }} />
                </div>
                <div className="flex justify-between text-xs" style={{ color: 'var(--text-2)' }}>
                  <span>{kgToTonnes(job.made_kg)} / {kgToTonnes(job.total_kg)} t · {pct}%</span>
                  <span>{job.on_site_date ?? '—'}</span>
                </div>
                {job.marks_missing_weight > 0 && (
                  <p className="text-xs mt-1" style={{ color: 'var(--warning)' }}>
                    {job.marks_missing_weight} mark(s) missing weight
                  </p>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </AppShell>
  )
}
