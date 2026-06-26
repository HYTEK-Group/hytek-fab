'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { AppShell } from '@/components/app-shell'
import { supabase } from '@/lib/supabase'
import type { FabJob } from '@/lib/types'

interface JobSummary extends FabJob {
  task_count: number
  task_done: number
  mark_count: number
  mark_done: number
  total_hours: number
  has_active_treatment: boolean
}

function statusBadge(j: JobSummary) {
  if (j.status === 'complete' || j.dispatch_requested_at)
    return { label: 'Dispatch ready', color: '#97C459', bg: 'rgba(99,153,34,.2)' }
  if (j.has_active_treatment)
    return { label: 'At treatment', color: '#85B7EB', bg: 'rgba(55,138,221,.2)' }
  return { label: 'In progress', color: '#FFCB05', bg: 'rgba(255,203,5,.15)' }
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
            { label: 'Total hrs (all)', value: jobs.reduce((s, j) => s + j.total_hours, 0).toFixed(0) },
          ].map(s => (
            <div key={s.label} className="rounded-xl p-3" style={{ background: '#1e1e21', border: '0.5px solid #2a2a2a' }}>
              <p className="text-xs mb-1" style={{ color: '#555' }}>{s.label}</p>
              <p className="text-xl font-medium" style={{ color: s.highlight ? '#97C459' : '#fff' }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Alerts */}
        {dispatchReady.length > 0 && (
          <div className="rounded-xl p-3 mb-4 flex gap-2" style={{ background: 'rgba(99,153,34,.1)', border: '0.5px solid rgba(99,153,34,.3)' }}>
            <span style={{ color: '#97C459' }}>✓</span>
            <p className="text-sm" style={{ color: '#97C459' }}>
              <strong style={{ color: '#fff' }}>{dispatchReady.map(j => j.name).join(', ')}</strong> — fab complete, dispatch alerted
            </p>
          </div>
        )}

        {/* Jobs */}
        <p className="text-xs mb-2" style={{ color: '#555', textTransform: 'uppercase', letterSpacing: '.07em' }}>
          {fetching ? 'Loading…' : `${active.length} active job${active.length !== 1 ? 's' : ''}`}
        </p>

        {jobs.length === 0 && !fetching && (
          <div className="rounded-xl p-6 text-center" style={{ background: '#1e1e21', border: '0.5px solid #2a2a2a' }}>
            <p style={{ color: '#555' }}>No active fab jobs. Check the Ready queue.</p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {jobs.map(job => {
            const badge = statusBadge(job)
            const pct = job.task_count ? Math.round((job.task_done / job.task_count) * 100) : 0
            return (
              <button
                key={job.id}
                onClick={() => router.push(`/jobs/${job.id}`)}
                className="rounded-xl p-3 text-left w-full"
                style={{ background: '#1e1e21', border: '0.5px solid #2a2a2a' }}
              >
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-medium" style={{ color: '#FFCB05' }}>{job.quote_number}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: badge.bg, color: badge.color }}>{badge.label}</span>
                </div>
                <p className="text-sm font-medium mb-0.5 truncate" style={{ color: '#fff' }}>{job.name}</p>
                <p className="text-xs mb-2 truncate" style={{ color: '#666' }}>{job.client ?? '—'}</p>
                <div className="rounded-full h-1 mb-1" style={{ background: '#2a2a2a' }}>
                  <div className="h-full rounded-full" style={{ background: '#FFCB05', width: `${pct}%` }} />
                </div>
                <div className="flex justify-between text-xs" style={{ color: '#555' }}>
                  <span>{job.task_done}/{job.task_count} tasks</span>
                  <span>{job.on_site_date ?? '—'}</span>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </AppShell>
  )
}
