'use client'

import { useEffect, useState, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { AppShell } from '@/components/app-shell'
import { supabase } from '@/lib/supabase'
import type { FabJob, FabTask, FabMark, FabTimeEntry } from '@/lib/types'

type Tab = 'tasks' | 'marks' | 'drawings' | 'treatment' | 'subs' | 'timelog'

interface JobDetail extends FabJob {
  task_count: number
  task_done: number
  mark_count: number
  mark_done: number
}

interface Drawing { name: string; url: string; size?: number }

// ── Tasks ────────────────────────────────────────────────────────────────────
function TasksTab({ jobId, token, role }: { jobId: string; token: string; role: string }) {
  const [tasks, setTasks] = useState<FabTask[]>([])
  const [desc, setDesc] = useState('')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/fab/jobs/${jobId}/tasks`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) setTasks((await res.json()).tasks ?? [])
  }, [jobId, token])

  useEffect(() => { load() }, [load])

  async function addTask() {
    if (!desc.trim()) return
    setAdding(true)
    await fetch(`/api/fab/jobs/${jobId}/tasks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: desc.trim() }),
    })
    setDesc('')
    setAdding(false)
    load()
  }

  async function updateTask(id: string, patch: Partial<FabTask>) {
    await fetch(`/api/fab/jobs/${jobId}/tasks/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    load()
  }

  const STATUSES: FabTask['status'][] = ['open', 'in_progress', 'done']
  const statusColor = (s: FabTask['status']) =>
    s === 'done' ? '#97C459' : s === 'in_progress' ? '#FFCB05' : '#555'

  return (
    <div>
      {(role === 'admin' || role === 'supervisor') && (
        <div className="flex gap-2 mb-4">
          <input placeholder="New task description…" value={desc} onChange={e => setDesc(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addTask()} className="flex-1" />
          <button onClick={addTask} disabled={adding || !desc.trim()} className="px-4 rounded-lg text-sm font-medium"
            style={{ background: '#FFCB05', color: '#231F20', border: 'none', opacity: adding || !desc.trim() ? .5 : 1 }}>
            Add
          </button>
        </div>
      )}

      {tasks.length === 0 && <p className="text-sm text-center py-6" style={{ color: '#555' }}>No tasks yet.</p>}

      <div className="flex flex-col gap-2">
        {tasks.map(task => (
          <div key={task.id} className="rounded-xl p-3" style={{ background: '#232326', border: '0.5px solid #2a2a2a' }}>
            <div className="flex justify-between items-start gap-2 mb-2">
              <p className="text-sm" style={{ color: task.status === 'done' ? '#555' : '#fff', textDecoration: task.status === 'done' ? 'line-through' : 'none' }}>
                {task.description}
              </p>
              <div className="flex gap-1 flex-shrink-0">
                {STATUSES.map(s => (
                  <button key={s} onClick={() => updateTask(task.id, { status: s })}
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{
                      background: task.status === s ? (s === 'done' ? 'rgba(99,153,34,.2)' : s === 'in_progress' ? 'rgba(255,203,5,.15)' : '#2a2a2a') : 'transparent',
                      color: task.status === s ? statusColor(s) : '#444',
                      border: `0.5px solid ${task.status === s ? statusColor(s) : '#333'}`,
                    }}>
                    {s === 'in_progress' ? 'WIP' : s}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-between items-center">
              <input placeholder="Assign to…" defaultValue={task.assigned_to ?? ''}
                onBlur={e => { if (e.target.value !== (task.assigned_to ?? '')) updateTask(task.id, { assigned_to: e.target.value || null as unknown as string }) }}
                className="text-xs w-40" style={{ background: 'transparent', border: '0.5px solid #2a2a2a', borderRadius: '6px', padding: '3px 6px', color: '#777' }} />
              {task.completed_at && (
                <span className="text-xs" style={{ color: '#555' }}>Done {task.completed_at.slice(0, 10)}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Marks ────────────────────────────────────────────────────────────────────
function MarksTab({ jobId, token }: { jobId: string; token: string }) {
  const [marks, setMarks] = useState<FabMark[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [newMark, setNewMark] = useState({ mark_id: '', section: '', length_mm: '', weight_kg: '', quantity: '1' })

  const load = useCallback(async () => {
    const res = await fetch(`/api/fab/jobs/${jobId}/marks`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) setMarks((await res.json()).marks ?? [])
  }, [jobId, token])

  useEffect(() => { load() }, [load])

  async function addMark() {
    if (!newMark.mark_id.trim()) return
    setAdding(true)
    await fetch(`/api/fab/jobs/${jobId}/marks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mark_id: newMark.mark_id.trim(),
        section: newMark.section.trim() || null,
        length_mm: newMark.length_mm ? parseInt(newMark.length_mm) : null,
        weight_kg: newMark.weight_kg ? parseFloat(newMark.weight_kg) : null,
        quantity: parseInt(newMark.quantity) || 1,
      }),
    })
    setNewMark({ mark_id: '', section: '', length_mm: '', weight_kg: '', quantity: '1' })
    setAdding(false)
    load()
  }

  async function bulkStatus(status: FabMark['status']) {
    if (selected.size === 0) return
    await fetch(`/api/fab/jobs/${jobId}/marks`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mark_ids: Array.from(selected), status }),
    })
    setSelected(new Set())
    load()
  }

  const toggleSelect = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const statusColor = (s: FabMark['status']) => {
    const map: Record<FabMark['status'], string> = {
      not_started: '#555', in_progress: '#FFCB05', done: '#97C459', at_treatment: '#85B7EB', returned: '#9B7FE0'
    }
    return map[s] ?? '#555'
  }

  const done = marks.filter(m => m.status === 'done' || m.status === 'returned').length

  return (
    <div>
      {/* Progress */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1 rounded-full h-1" style={{ background: '#2a2a2a' }}>
          <div className="h-full rounded-full" style={{ background: '#FFCB05', width: marks.length ? `${(done / marks.length) * 100}%` : '0%' }} />
        </div>
        <span className="text-xs" style={{ color: '#777' }}>{done}/{marks.length}</span>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="rounded-xl p-2 mb-3 flex gap-2 items-center" style={{ background: '#232326', border: '0.5px solid #2a2a2a' }}>
          <span className="text-xs mr-2" style={{ color: '#777' }}>{selected.size} selected</span>
          {(['in_progress', 'done', 'at_treatment'] as FabMark['status'][]).map(s => (
            <button key={s} onClick={() => bulkStatus(s)} className="text-xs px-3 py-1 rounded-full"
              style={{ background: 'transparent', border: `0.5px solid ${statusColor(s)}`, color: statusColor(s) }}>
              → {s.replace('_', ' ')}
            </button>
          ))}
        </div>
      )}

      {/* Add mark form */}
      <div className="rounded-xl p-3 mb-3" style={{ background: '#232326', border: '0.5px solid #2a2a2a' }}>
        <p className="text-xs mb-2" style={{ color: '#555' }}>Add mark</p>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div><label className="text-xs block mb-1" style={{ color: '#555' }}>Mark ID</label>
            <input placeholder="A1" value={newMark.mark_id} onChange={e => setNewMark(p => ({ ...p, mark_id: e.target.value }))} /></div>
          <div><label className="text-xs block mb-1" style={{ color: '#555' }}>Section</label>
            <input placeholder="310UB46" value={newMark.section} onChange={e => setNewMark(p => ({ ...p, section: e.target.value }))} /></div>
          <div><label className="text-xs block mb-1" style={{ color: '#555' }}>Length (mm)</label>
            <input type="number" placeholder="3200" value={newMark.length_mm} onChange={e => setNewMark(p => ({ ...p, length_mm: e.target.value }))} /></div>
          <div><label className="text-xs block mb-1" style={{ color: '#555' }}>Weight (kg)</label>
            <input type="number" placeholder="46.5" step="0.1" value={newMark.weight_kg} onChange={e => setNewMark(p => ({ ...p, weight_kg: e.target.value }))} /></div>
        </div>
        <button onClick={addMark} disabled={adding || !newMark.mark_id.trim()} className="w-full rounded-lg text-sm font-medium"
          style={{ background: '#FFCB05', color: '#231F20', padding: '8px', border: 'none', opacity: adding || !newMark.mark_id.trim() ? .5 : 1 }}>
          Add mark
        </button>
      </div>

      {marks.length === 0 && <p className="text-sm text-center py-6" style={{ color: '#555' }}>No marks. Add from Tekla list.</p>}

      <div className="flex flex-col gap-1">
        {marks.map(mark => (
          <div key={mark.id} className="rounded-lg p-2 flex items-center gap-2"
            style={{ background: selected.has(mark.id) ? 'rgba(255,203,5,.05)' : '#232326', border: `0.5px solid ${selected.has(mark.id) ? '#FFCB05' : '#2a2a2a'}`, cursor: 'pointer' }}
            onClick={() => toggleSelect(mark.id)}>
            <div className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center"
              style={{ background: selected.has(mark.id) ? '#FFCB05' : '#2a2a2a', border: '0.5px solid #333' }}>
              {selected.has(mark.id) && <span style={{ color: '#231F20', fontSize: '10px' }}>✓</span>}
            </div>
            <span className="text-xs font-medium w-10 flex-shrink-0" style={{ color: '#FFCB05' }}>{mark.mark_id}</span>
            <span className="text-xs flex-1 truncate" style={{ color: '#888' }}>{mark.section ?? '—'}</span>
            {mark.length_mm && <span className="text-xs" style={{ color: '#555' }}>{(mark.length_mm / 1000).toFixed(2)}m</span>}
            <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'transparent', border: `0.5px solid ${statusColor(mark.status)}`, color: statusColor(mark.status) }}>
              {mark.status.replace('_', ' ')}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Drawings ─────────────────────────────────────────────────────────────────
function DrawingsTab({ jobId, token }: { jobId: string; token: string }) {
  const [drawings, setDrawings] = useState<Drawing[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/fab/jobs/${jobId}/drawings`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : { drawings: [] })
      .then(j => { setDrawings(j.drawings ?? []); setLoading(false) })
  }, [jobId, token])

  if (loading) return <p className="text-sm text-center py-6" style={{ color: '#555' }}>Loading…</p>
  if (drawings.length === 0)
    return (
      <div className="rounded-xl p-6 text-center" style={{ background: '#232326', border: '0.5px solid #2a2a2a' }}>
        <p style={{ color: '#555' }}>No drawings yet. Sync server uploads PDFs when Y: drive is accessible.</p>
      </div>
    )

  return (
    <div className="flex flex-col gap-2">
      {drawings.map(d => (
        <a key={d.name} href={d.url} target="_blank" rel="noopener noreferrer"
          className="rounded-xl p-3 flex items-center gap-3 no-underline"
          style={{ background: '#232326', border: '0.5px solid #2a2a2a' }}>
          <span style={{ color: '#FFCB05', fontSize: '20px' }}>📄</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate" style={{ color: '#fff' }}>{d.name}</p>
            {d.size && <p className="text-xs" style={{ color: '#555' }}>{(d.size / 1024).toFixed(0)} KB</p>}
          </div>
          <span className="text-xs" style={{ color: '#FFCB05' }}>Open ↗</span>
        </a>
      ))}
    </div>
  )
}

// ── Treatment ─────────────────────────────────────────────────────────────────
function TreatmentTab() {
  return (
    <div className="rounded-xl p-6 text-center" style={{ background: '#232326', border: '0.5px solid #2a2a2a' }}>
      <p className="text-sm mb-1" style={{ color: '#fff' }}>Treatment batches</p>
      <p className="text-xs" style={{ color: '#555' }}>Use Mark tab to set marks to "At treatment" status. Treatment batch tracking coming soon.</p>
    </div>
  )
}

// ── Sub packages ─────────────────────────────────────────────────────────────
function SubsTab() {
  return (
    <div className="rounded-xl p-6 text-center" style={{ background: '#232326', border: '0.5px solid #2a2a2a' }}>
      <p className="text-sm mb-1" style={{ color: '#fff' }}>Sub packages</p>
      <p className="text-xs" style={{ color: '#555' }}>External sub-contractor packages. Coming soon.</p>
    </div>
  )
}

// ── Time log ──────────────────────────────────────────────────────────────────
function TimeLogTab({ jobId, token }: { jobId: string; token: string }) {
  const [entries, setEntries] = useState<FabTimeEntry[]>([])
  const [form, setForm] = useState({ worker_name: '', hours: '', work_date: new Date().toISOString().slice(0, 10), note: '' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/fab/jobs/${jobId}/time-log`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) setEntries((await res.json()).entries ?? [])
  }, [jobId, token])

  useEffect(() => { load() }, [load])

  async function addEntry() {
    if (!form.worker_name.trim() || !parseFloat(form.hours)) return
    setSaving(true)
    await fetch(`/api/fab/jobs/${jobId}/time-log`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_name: form.worker_name.trim(), hours: parseFloat(form.hours), work_date: form.work_date, note: form.note.trim() || null }),
    })
    setForm(f => ({ ...f, worker_name: '', hours: '', note: '' }))
    setSaving(false)
    load()
  }

  const totalHours = entries.reduce((s, e) => s + (e.hours ?? 0), 0)

  return (
    <div>
      <div className="rounded-xl p-3 mb-4" style={{ background: '#232326', border: '0.5px solid #2a2a2a' }}>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div><label className="text-xs block mb-1" style={{ color: '#555' }}>Worker</label>
            <input placeholder="Name" value={form.worker_name} onChange={e => setForm(f => ({ ...f, worker_name: e.target.value }))} /></div>
          <div><label className="text-xs block mb-1" style={{ color: '#555' }}>Hours</label>
            <input type="number" min="0" step="0.5" placeholder="0" value={form.hours} onChange={e => setForm(f => ({ ...f, hours: e.target.value }))} /></div>
          <div><label className="text-xs block mb-1" style={{ color: '#555' }}>Date</label>
            <input type="date" value={form.work_date} onChange={e => setForm(f => ({ ...f, work_date: e.target.value }))} /></div>
          <div><label className="text-xs block mb-1" style={{ color: '#555' }}>Note</label>
            <input placeholder="Optional" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} /></div>
        </div>
        <button onClick={addEntry} disabled={saving || !form.worker_name.trim() || !parseFloat(form.hours)}
          className="w-full rounded-lg text-sm font-medium"
          style={{ background: '#FFCB05', color: '#231F20', padding: '8px', border: 'none', opacity: saving || !form.worker_name.trim() ? .5 : 1 }}>
          Log time
        </button>
      </div>

      <div className="flex justify-between text-xs mb-2" style={{ color: '#555' }}>
        <span>{entries.length} entries</span>
        <span>Total: {totalHours.toFixed(1)} hrs</span>
      </div>

      <div className="flex flex-col gap-1">
        {entries.map(e => (
          <div key={e.id} className="rounded-lg p-2 flex justify-between items-center" style={{ background: '#232326', border: '0.5px solid #2a2a2a' }}>
            <div>
              <p className="text-sm" style={{ color: '#fff' }}>{e.worker_name}</p>
              <p className="text-xs" style={{ color: '#555' }}>{e.work_date} {e.note ? `· ${e.note}` : ''}</p>
            </div>
            <span className="text-sm font-medium" style={{ color: '#FFCB05' }}>{e.hours} hrs</span>
          </div>
        ))}
        {entries.length === 0 && <p className="text-sm text-center py-4" style={{ color: '#555' }}>No time entries yet.</p>}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { user, loading } = useAuth()
  const router = useRouter()
  const [job, setJob] = useState<JobDetail | null>(null)
  const [tab, setTab] = useState<Tab>('tasks')
  const [token, setToken] = useState('')
  const [role, setRole] = useState('fabricator')
  const [dispatching, setDispatching] = useState(false)

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    setToken(session.access_token)
    const res = await fetch('/api/fab/jobs', { headers: { Authorization: `Bearer ${session.access_token}` } })
    if (res.ok) {
      const jobs = (await res.json()).jobs ?? []
      const found = jobs.find((j: JobDetail) => j.id === id)
      if (found) setJob(found)
    }
  }, [id])

  useEffect(() => { if (!loading && !user) router.push('/login') }, [user, loading, router])
  useEffect(() => {
    if (user) {
      load()
      supabase.from('profiles').select('role').eq('id', user.id).single()
        .then(({ data }) => { if (data?.role) setRole(data.role as string) })
    }
  }, [user, load])

  async function dispatch() {
    setDispatching(true)
    const res = await fetch(`/api/fab/jobs/${id}/dispatch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    setDispatching(false)
    if (res.ok) load()
  }

  if (loading || !user) return null
  if (!job) return <AppShell><div className="p-6 text-center" style={{ color: '#555' }}>Loading…</div></AppShell>

  const pct = job.task_count ? Math.round((job.task_done / job.task_count) * 100) : 0
  const canDispatch = (role === 'admin' || role === 'supervisor') && job.status !== 'complete' && !job.dispatch_requested_at

  const TABS: { id: Tab; label: string }[] = [
    { id: 'tasks', label: 'Tasks' },
    { id: 'marks', label: 'Marks' },
    { id: 'drawings', label: 'Drawings' },
    { id: 'treatment', label: 'Treatment' },
    { id: 'subs', label: 'Subs' },
    { id: 'timelog', label: 'Time' },
  ]

  return (
    <AppShell>
      <div className="p-4 max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-4">
          <button onClick={() => router.push('/shop')} className="text-xs mb-2 block" style={{ background: 'none', border: 'none', color: '#555', padding: 0 }}>
            ← Shop
          </button>
          <div className="flex justify-between items-start mb-1">
            <span className="text-xs font-medium" style={{ color: '#FFCB05' }}>{job.quote_number}</span>
            {job.dispatch_requested_at && (
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(99,153,34,.15)', color: '#97C459', border: '0.5px solid rgba(99,153,34,.3)' }}>
                Dispatch ready
              </span>
            )}
          </div>
          <p className="text-base font-semibold mb-0.5" style={{ color: '#fff' }}>{job.name}</p>
          <p className="text-xs mb-2" style={{ color: '#666' }}>{job.client ?? '—'} {job.on_site_date ? `· On site ${job.on_site_date}` : ''}</p>
          <div className="flex gap-4 text-xs mb-3" style={{ color: '#555' }}>
            <span>{job.task_done}/{job.task_count} tasks · {pct}%</span>
            <span>{job.mark_done}/{job.mark_count} marks</span>
          </div>
          <div className="rounded-full h-1 mb-3" style={{ background: '#2a2a2a' }}>
            <div className="h-full rounded-full" style={{ background: '#FFCB05', width: `${pct}%` }} />
          </div>

          {canDispatch && (
            <button onClick={dispatch} disabled={dispatching} className="w-full rounded-lg text-sm font-medium"
              style={{ background: dispatching ? '#333' : '#97C459', color: dispatching ? '#555' : '#fff', padding: '10px', border: 'none', fontWeight: 600 }}>
              {dispatching ? 'Marking complete…' : 'Mark fab complete + alert Dispatch'}
            </button>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 mb-4 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="text-xs px-3 py-1.5 rounded-lg flex-shrink-0"
              style={{
                background: tab === t.id ? '#FFCB05' : '#1e1e21',
                color: tab === t.id ? '#231F20' : '#777',
                border: tab === t.id ? 'none' : '0.5px solid #2a2a2a',
                fontWeight: tab === t.id ? 600 : 400,
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {token && <>
          {tab === 'tasks' && <TasksTab jobId={id} token={token} role={role} />}
          {tab === 'marks' && <MarksTab jobId={id} token={token} />}
          {tab === 'drawings' && <DrawingsTab jobId={id} token={token} />}
          {tab === 'treatment' && <TreatmentTab />}
          {tab === 'subs' && <SubsTab />}
          {tab === 'timelog' && <TimeLogTab jobId={id} token={token} />}
        </>}
      </div>
    </AppShell>
  )
}
