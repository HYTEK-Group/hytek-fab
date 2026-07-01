'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { AppShell } from '@/components/app-shell'
import { supabase } from '@/lib/supabase'
import type { FabJob } from '@/lib/types'

function prevMonday(offset = 0): string {
  const d = new Date()
  const day = d.getUTCDay()
  const diff = day === 0 ? 6 : day - 1
  d.setUTCDate(d.getUTCDate() - diff - offset * 7)
  return d.toISOString().slice(0, 10)
}

function fmtWeek(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  const end = new Date(d)
  end.setUTCDate(end.getUTCDate() + 6)
  return `${d.getUTCDate()} ${d.toLocaleString('en-AU', { month: 'short', timeZone: 'UTC' })} – ${end.getUTCDate()} ${end.toLocaleString('en-AU', { month: 'short', timeZone: 'UTC' })} ${end.getUTCFullYear()}`
}

export default function TonnesPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [jobs, setJobs] = useState<FabJob[]>([])
  const [weekOffset, setWeekOffset] = useState(0)
  const [entries, setEntries] = useState<Record<string, { tonnes: string; hours: string; note: string }>>({})
  const [history, setHistory] = useState<Array<Record<string, unknown>>>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const weekStart = prevMonday(weekOffset)

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const tok = session.access_token
    const [jobsRes, histRes] = await Promise.all([
      fetch('/api/fab/jobs', { headers: { Authorization: `Bearer ${tok}` } }),
      fetch('/api/fab/tonnes?limit=30', { headers: { Authorization: `Bearer ${tok}` } }),
    ])
    if (jobsRes.ok) setJobs((await jobsRes.json()).jobs ?? [])
    if (histRes.ok) setHistory((await histRes.json()).entries ?? [])
  }, [])

  useEffect(() => { if (!loading && !user) router.push('/login') }, [user, loading, router])
  useEffect(() => { if (user) load() }, [user, load])

  function setEntry(jobId: string, field: 'tonnes' | 'hours' | 'note', val: string) {
    setEntries(prev => ({ ...prev, [jobId]: { ...prev[jobId], tonnes: prev[jobId]?.tonnes ?? '', hours: prev[jobId]?.hours ?? '', note: prev[jobId]?.note ?? '', [field]: val } }))
  }

  const activeJobs = jobs.filter(j => j.status === 'in_progress')
  const total = activeJobs.reduce((s, j) => s + (parseFloat(entries[j.id]?.tonnes) || 0), 0)

  async function submit() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const jobEntries = activeJobs
      .filter(j => parseFloat(entries[j.id]?.tonnes) > 0)
      .map(j => ({
        fab_job_id: j.id,
        quote_number: j.quote_number,
        tonnes: parseFloat(entries[j.id].tonnes),
        hours: parseFloat(entries[j.id]?.hours) || null,
        note: entries[j.id]?.note || null,
      }))
    if (jobEntries.length === 0) return

    setSubmitting(true)
    const res = await fetch('/api/fab/tonnes', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ week_start: weekStart, entries: jobEntries }),
    })
    setSubmitting(false)
    if (res.ok) { setSubmitted(true); load() }
  }

  if (loading || !user) return null

  return (
    <AppShell>
      <div className="p-4 max-w-2xl mx-auto">
        {/* Week picker */}
        <div className="rounded-xl p-3 mb-4 flex items-center justify-between" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
          <button onClick={() => { setWeekOffset(w => w + 1); setSubmitted(false) }} className="text-xl px-2" style={{ background: 'none', border: 'none', color: 'var(--hytek-yellow)' }}>‹</button>
          <div className="text-center">
            <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>{fmtWeek(weekStart)}</p>
            <p className="text-xs" style={{ color: 'var(--text-2)' }}>{weekOffset === 0 ? 'Current week' : `${weekOffset} week${weekOffset > 1 ? 's' : ''} ago`}</p>
          </div>
          <button onClick={() => { setWeekOffset(w => Math.max(0, w - 1)); setSubmitted(false) }} disabled={weekOffset === 0} className="text-xl px-2" style={{ background: 'none', border: 'none', color: weekOffset === 0 ? 'var(--border)' : 'var(--hytek-yellow)' }}>›</button>
        </div>

        <p className="text-xs mb-2" style={{ color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '.07em' }}>Tonnes per job this week</p>

        {activeJobs.length === 0 && (
          <div className="rounded-xl p-6 text-center mb-4" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
            <p style={{ color: 'var(--text-2)' }}>No active fab jobs.</p>
          </div>
        )}

        <div className="flex flex-col gap-3 mb-4">
          {activeJobs.map(job => (
            <div key={job.id} className="rounded-xl p-3" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
              <p className="text-xs font-medium mb-0.5" style={{ color: 'var(--foreground)', fontWeight: 700 }}>{job.quote_number}</p>
              <p className="text-sm font-medium mb-3" style={{ color: 'var(--foreground)' }}>{job.name}</p>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div>
                  <label className="text-xs block mb-1" style={{ color: 'var(--text-2)' }}>Tonnes</label>
                  <input type="number" min="0" step="0.1" placeholder="0.0" value={entries[job.id]?.tonnes ?? ''} onChange={e => setEntry(job.id, 'tonnes', e.target.value)} />
                </div>
                <div>
                  <label className="text-xs block mb-1" style={{ color: 'var(--text-2)' }}>Hours</label>
                  <input type="number" min="0" step="0.5" placeholder="0" value={entries[job.id]?.hours ?? ''} onChange={e => setEntry(job.id, 'hours', e.target.value)} />
                </div>
              </div>
              <textarea rows={2} placeholder="Note (optional)" value={entries[job.id]?.note ?? ''} onChange={e => setEntry(job.id, 'note', e.target.value)} style={{ height: '52px', resize: 'none' }} />
            </div>
          ))}
        </div>

        {/* Total */}
        <div className="rounded-xl p-3 mb-4 flex justify-between items-center" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
          <span className="text-sm" style={{ color: 'var(--text-2)' }}>Total this week</span>
          <span style={{ color: 'var(--foreground)', fontWeight: 700, fontSize: '22px' }}>{total.toFixed(1)} t</span>
        </div>

        {submitted && <p className="text-sm text-center mb-3" style={{ color: 'var(--success)' }}>✓ Submitted to Hub</p>}

        <button
          onClick={submit}
          disabled={submitting || total === 0}
          className="w-full rounded-lg text-sm font-medium mb-6"
          style={{ background: submitting || total === 0 ? 'var(--surface-2)' : 'var(--hytek-yellow)', color: 'var(--on-brand)', padding: '12px', border: 'none', cursor: total === 0 ? 'not-allowed' : 'pointer' }}
        >
          {submitting ? 'Submitting…' : 'Submit to Hub'}
        </button>

        {/* History */}
        {history.length > 0 && (
          <>
            <p className="text-xs mb-2" style={{ color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '.07em' }}>Recent entries</p>
            <div className="rounded-xl overflow-hidden" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
              {history.slice(0, 10).map((e, i) => (
                <div key={String(e.id)} className="flex justify-between items-center p-3" style={{ borderBottom: i < 9 ? '0.5px solid var(--border)' : 'none' }}>
                  <div>
                    <p className="text-xs font-medium" style={{ color: 'var(--foreground)', fontWeight: 700 }}>{String(e.quote_number)}</p>
                    <p className="text-xs" style={{ color: 'var(--text-2)' }}>{String(e.week_start)} · {String(e.entered_by)}</p>
                  </div>
                  <span className="text-sm font-medium" style={{ color: 'var(--foreground)', fontWeight: 700 }}>{Number(e.tonnes).toFixed(1)} t</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}
