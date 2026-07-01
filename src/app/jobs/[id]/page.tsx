'use client'

import { useEffect, useState, useCallback, use } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { AppShell } from '@/components/app-shell'
import { supabase } from '@/lib/supabase'
import { kgToTonnes } from '@/lib/fab-tonnage'
import type { FabJob, FabTask, FabMark, FabTimeEntry } from '@/lib/types'

type Tab = 'tasks' | 'marks' | 'drawings' | 'packages' | 'qc' | 'dispatch' | 'timelog'

interface JobDetail extends FabJob {
  task_count: number
  task_done: number
  mark_count: number
  mark_done: number
  total_hours: number
  total_kg: number
  made_kg: number
  tonnage_pct: number
  marks_missing_weight: number
}

interface Drawing { name: string; url: string; size?: number }

// ── Tasks (+ productivity matrix) ────────────────────────────────────────────
type MatrixTask = FabTask & {
  actual_hours?: number
  tonnes?: number
  variance_hours?: number | null
  tonnes_per_hour?: number | null
  linked_marks?: number
}
interface MatrixTotals { total_estimated: number; total_actual: number; total_tonnes: number; tonnes_per_hour: number | null }

function TasksTab({ jobId, token, role }: { jobId: string; token: string; role: string }) {
  const isSup = role === 'admin' || role === 'supervisor'
  const [tasks, setTasks] = useState<MatrixTask[]>([])
  const [totals, setTotals] = useState<MatrixTotals | null>(null)
  const [marks, setMarks] = useState<FabMark[]>([])
  const [form, setForm] = useState({ desc: '', est: '', due: '' })
  const [adding, setAdding] = useState(false)
  const [openTask, setOpenTask] = useState<string | null>(null)
  const [assigned, setAssigned] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    const res = await fetch(`/api/fab/jobs/${jobId}/tasks`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) { const j = await res.json(); setTasks(j.tasks ?? []); setTotals(j.matrix_totals ?? null) }
  }, [jobId, token])
  const loadMarks = useCallback(async () => {
    const res = await fetch(`/api/fab/jobs/${jobId}/marks`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) setMarks((await res.json()).marks ?? [])
  }, [jobId, token])

  useEffect(() => { load(); loadMarks() }, [load, loadMarks])

  async function addTask() {
    if (!form.desc.trim()) return
    setAdding(true)
    await fetch(`/api/fab/jobs/${jobId}/tasks`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: form.desc.trim(), estimated_hours: form.est ? parseFloat(form.est) : null, due_on: form.due || null }),
    })
    setForm({ desc: '', est: '', due: '' }); setAdding(false); load()
  }
  async function updateTask(id: string, patch: Record<string, unknown>) {
    await fetch(`/api/fab/jobs/${jobId}/tasks/${id}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    load()
  }
  async function openAssign(taskId: string) {
    if (openTask === taskId) { setOpenTask(null); return }
    const res = await fetch(`/api/fab/jobs/${jobId}/tasks/${taskId}/marks`, { headers: { Authorization: `Bearer ${token}` } })
    setAssigned(new Set(res.ok ? (await res.json()).mark_ids : []))
    setOpenTask(taskId)
  }
  async function toggleMark(taskId: string, markId: string) {
    const has = assigned.has(markId)
    await fetch(`/api/fab/jobs/${jobId}/tasks/${taskId}/marks`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(has ? { remove: [markId] } : { add: [markId] }),
    })
    setAssigned(prev => { const n = new Set(prev); has ? n.delete(markId) : n.add(markId); return n })
    load()
  }

  const STATUSES: FabTask['status'][] = ['open', 'in_progress', 'done']
  const statusColor = (s: FabTask['status']) => s === 'done' ? 'var(--success)' : s === 'in_progress' ? 'var(--hytek-yellow)' : 'var(--text-2)'
  const hrs = (n: number | null | undefined) => n == null ? '—' : `${n}h`

  return (
    <div>
      {/* Matrix totals */}
      {totals && (
        <div className="rounded-xl p-3 mb-3 grid grid-cols-4 gap-2 text-center" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
          {[
            { l: 'Allotted', v: `${totals.total_estimated}h` },
            { l: 'Actual', v: `${totals.total_actual}h` },
            { l: 'Tonnes', v: `${totals.total_tonnes}t` },
            { l: 't / hr', v: totals.tonnes_per_hour ?? '—' },
          ].map(s => (
            <div key={s.l}><p className="text-xs" style={{ color: 'var(--text-2)' }}>{s.l}</p><p className="text-sm font-medium" style={{ color: 'var(--foreground)', fontWeight: 700 }}>{s.v}</p></div>
          ))}
        </div>
      )}

      {isSup && (
        <div className="rounded-xl p-3 mb-3" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
          <p className="text-xs mb-2" style={{ color: 'var(--text-2)' }}>Add task (break the job down — allot hours + a due date)</p>
          <div className="flex gap-2 flex-wrap items-center">
            <input placeholder="Task description…" value={form.desc} onChange={e => setForm(f => ({ ...f, desc: e.target.value }))} className="flex-1" style={{ minWidth: 160 }} />
            <input type="number" min="0" step="0.5" placeholder="Allotted h" value={form.est} onChange={e => setForm(f => ({ ...f, est: e.target.value }))} style={{ width: 100 }} />
            <input type="date" value={form.due} onChange={e => setForm(f => ({ ...f, due: e.target.value }))} style={{ width: 150 }} />
            <button onClick={addTask} disabled={adding || !form.desc.trim()} className="px-4 rounded-lg text-sm font-medium"
              style={{ background: 'var(--hytek-yellow)', color: 'var(--on-brand)', border: 'none', opacity: adding || !form.desc.trim() ? .5 : 1 }}>Add</button>
          </div>
        </div>
      )}

      {tasks.length === 0 && <p className="text-sm text-center py-6" style={{ color: 'var(--text-2)' }}>No tasks yet.</p>}

      <div className="flex flex-col gap-2">
        {tasks.map(task => (
          <div key={task.id} className="rounded-xl p-3" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
            <div className="flex justify-between items-start gap-2 mb-2">
              <p className="text-sm" style={{ color: task.status === 'done' ? 'var(--text-2)' : 'var(--foreground)', textDecoration: task.status === 'done' ? 'line-through' : 'none' }}>{task.description}</p>
              <div className="flex gap-1 flex-shrink-0">
                {STATUSES.map(s => (
                  <button key={s} onClick={() => updateTask(task.id, { status: s })} className="text-xs px-2 py-0.5 rounded-full"
                    style={{ background: task.status === s ? (s === 'done' ? 'var(--chip-success-bg)' : s === 'in_progress' ? 'var(--chip-brand-bg)' : 'var(--surface-2)') : 'transparent', color: task.status === s ? statusColor(s) : 'var(--text-2)', border: `0.5px solid ${task.status === s ? statusColor(s) : 'var(--border)'}` }}>
                    {s === 'in_progress' ? 'WIP' : s}
                  </button>
                ))}
              </div>
            </div>

            {/* Matrix row */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mb-2" style={{ color: 'var(--text-3)' }}>
              <span>Allotted {hrs(task.estimated_hours)}</span>
              <span>Actual {task.actual_hours ?? 0}h</span>
              {task.variance_hours != null && (
                <span style={{ color: task.variance_hours > 0 ? 'var(--warning)' : 'var(--success)' }}>
                  {task.variance_hours > 0 ? `+${task.variance_hours}h over` : `${Math.abs(task.variance_hours)}h under`}
                </span>
              )}
              <span>{task.tonnes ?? 0}t</span>
              <span style={{ color: 'var(--foreground)', fontWeight: 700 }}>{task.tonnes_per_hour != null ? `${task.tonnes_per_hour} t/hr` : '—'}</span>
              {task.due_on && <span>due {task.due_on}</span>}
            </div>

            <div className="flex justify-between items-center gap-2">
              <input placeholder="Assign worker…" defaultValue={task.assigned_to ?? ''}
                onBlur={e => { if (e.target.value !== (task.assigned_to ?? '')) updateTask(task.id, { assigned_to: e.target.value || null }) }}
                className="text-xs" style={{ width: 140, background: 'transparent', border: '0.5px solid var(--border)', borderRadius: 6, padding: '3px 6px', color: 'var(--text-2)' }} />
              {isSup && (
                <input type="number" min="0" step="0.5" placeholder="allot h" defaultValue={task.estimated_hours ?? ''}
                  onBlur={e => { const v = e.target.value === '' ? null : parseFloat(e.target.value); if (v !== (task.estimated_hours ?? null)) updateTask(task.id, { estimated_hours: v }) }}
                  className="text-xs" style={{ width: 70, background: 'transparent', border: '0.5px solid var(--border)', borderRadius: 6, padding: '3px 6px', color: 'var(--text-2)' }} />
              )}
              <button onClick={() => openAssign(task.id)} className="text-xs" style={{ color: 'var(--info)', background: 'none', border: 'none', cursor: 'pointer' }}>
                marks ({task.linked_marks ?? 0}) {openTask === task.id ? '▾' : '▸'}
              </button>
            </div>

            {openTask === task.id && (
              <div className="mt-2 flex flex-wrap gap-1">
                {marks.length === 0 && <span className="text-xs" style={{ color: 'var(--text-2)' }}>No marks on this job yet.</span>}
                {marks.map(m => (
                  <button key={m.id} onClick={() => toggleMark(task.id, m.id)} className="text-xs px-2 py-0.5 rounded-full"
                    style={{ background: assigned.has(m.id) ? 'var(--chip-info-bg)' : 'transparent', border: `0.5px solid ${assigned.has(m.id) ? 'var(--info)' : 'var(--border)'}`, color: assigned.has(m.id) ? 'var(--info)' : 'var(--text-3)' }}>
                    {m.mark_id}
                  </button>
                ))}
              </div>
            )}
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
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const [bomImporting, setBomImporting] = useState(false)
  const [bomMsg, setBomMsg] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/fab/jobs/${jobId}/marks`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) setMarks((await res.json()).marks ?? [])
  }, [jobId, token])

  async function importAssembly(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImporting(true); setImportMsg('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/fab/jobs/${jobId}/import-assembly`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
      })
      const j = await res.json()
      if (!res.ok) { setImportMsg('❌ ' + (j.error ?? 'Import failed')); return }
      let msg = `✓ Issue ${j.version}: ${j.parsed} assemblies (${(j.total_kg / 1000).toFixed(2)} t). Added ${j.added}`
      if (j.changed_applied) msg += `, updated ${j.changed_applied}`
      if (j.protected?.length) msg += `, ${j.protected.length} protected (review w/ detailing)`
      if (j.removed?.length) msg += `, ${j.removed.length} removed (review)`
      if (j.project_match === false) msg += ` ⚠ file is ${j.project_number}, job is ${j.quote_number}`
      setImportMsg(msg)
      load()
    } finally { setImporting(false) }
  }

  async function importBom(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!files.length) return
    setBomImporting(true); setBomMsg('')
    try {
      const fd = new FormData()
      for (const f of files) fd.append('file', f)
      const res = await fetch(`/api/fab/jobs/${jobId}/import-bom`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
      })
      const j = await res.json()
      if (!res.ok) { setBomMsg('❌ ' + (j.error ?? 'BOM import failed')); return }
      let msg = `✓ ${j.total_lines} BOM line(s) from ${j.reports?.length ?? 0} report(s) → purchasing`
      if (j.skipped?.length) msg += `, ${j.skipped.length} skipped`
      setBomMsg(msg)
    } finally { setBomImporting(false) }
  }

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
      not_started: 'var(--text-2)', in_progress: 'var(--hytek-yellow)', done: 'var(--success)', at_contractor: 'var(--info)', returned: 'var(--accent)', qc_passed: 'var(--success)'
    }
    return map[s] ?? 'var(--text-2)'
  }

  const done = marks.filter(m => m.status === 'done' || m.status === 'returned' || m.status === 'qc_passed').length

  return (
    <div>
      {/* Import Assembly List */}
      <div className="rounded-xl p-3 mb-3" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs" style={{ color: 'var(--text-2)' }}>Import Tekla Assembly List (.xlsx) — auto-loads marks + weights</p>
          <label className="text-xs px-3 py-1.5 rounded-lg font-medium" style={{ background: 'var(--hytek-yellow)', color: 'var(--on-brand)', cursor: 'pointer', opacity: importing ? 0.5 : 1 }}>
            {importing ? 'Importing…' : 'Import'}
            <input type="file" accept=".xlsx,.xls" disabled={importing} onChange={importAssembly} style={{ display: 'none' }} />
          </label>
        </div>
        {importMsg && <p className="text-xs mt-2" style={{ color: importMsg.startsWith('❌') ? 'var(--danger)' : 'var(--success)' }}>{importMsg}</p>}
        <div className="flex items-center justify-between gap-2 mt-3 pt-3" style={{ borderTop: '0.5px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-2)' }}>Import BOM reports (Part Material / Plate / Bolt / Chemset) — for purchasing</p>
          <label className="text-xs px-3 py-1.5 rounded-lg font-medium" style={{ background: 'transparent', color: 'var(--foreground)', border: '0.5px solid var(--hytek-yellow)', cursor: 'pointer', opacity: bomImporting ? 0.5 : 1, fontWeight: 700 }}>
            {bomImporting ? 'Importing…' : 'Import BOM'}
            <input type="file" accept=".xlsx,.xls" multiple disabled={bomImporting} onChange={importBom} style={{ display: 'none' }} />
          </label>
        </div>
        {bomMsg && <p className="text-xs mt-2" style={{ color: bomMsg.startsWith('❌') ? 'var(--danger)' : 'var(--success)' }}>{bomMsg}</p>}
      </div>

      {/* Progress */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1 rounded-full h-1" style={{ background: 'var(--track)' }}>
          <div className="h-full rounded-full" style={{ background: 'var(--hytek-yellow)', width: marks.length ? `${(done / marks.length) * 100}%` : '0%' }} />
        </div>
        <span className="text-xs" style={{ color: 'var(--text-2)' }}>{done}/{marks.length}</span>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="rounded-xl p-2 mb-3 flex gap-2 items-center" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
          <span className="text-xs mr-2" style={{ color: 'var(--text-2)' }}>{selected.size} selected</span>
          {(['in_progress', 'done', 'at_contractor'] as FabMark['status'][]).map(s => (
            <button key={s} onClick={() => bulkStatus(s)} className="text-xs px-3 py-1 rounded-full"
              style={{ background: 'transparent', border: `0.5px solid ${statusColor(s)}`, color: statusColor(s) }}>
              → {s.replace('_', ' ')}
            </button>
          ))}
        </div>
      )}

      {/* Add mark form */}
      <div className="rounded-xl p-3 mb-3" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
        <p className="text-xs mb-2" style={{ color: 'var(--text-2)' }}>Add mark</p>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div><label className="text-xs block mb-1" style={{ color: 'var(--text-2)' }}>Mark ID</label>
            <input placeholder="A1" value={newMark.mark_id} onChange={e => setNewMark(p => ({ ...p, mark_id: e.target.value }))} /></div>
          <div><label className="text-xs block mb-1" style={{ color: 'var(--text-2)' }}>Section</label>
            <input placeholder="310UB46" value={newMark.section} onChange={e => setNewMark(p => ({ ...p, section: e.target.value }))} /></div>
          <div><label className="text-xs block mb-1" style={{ color: 'var(--text-2)' }}>Length (mm)</label>
            <input type="number" placeholder="3200" value={newMark.length_mm} onChange={e => setNewMark(p => ({ ...p, length_mm: e.target.value }))} /></div>
          <div><label className="text-xs block mb-1" style={{ color: 'var(--text-2)' }}>Weight (kg)</label>
            <input type="number" placeholder="46.5" step="0.1" value={newMark.weight_kg} onChange={e => setNewMark(p => ({ ...p, weight_kg: e.target.value }))} /></div>
        </div>
        <button onClick={addMark} disabled={adding || !newMark.mark_id.trim()} className="w-full rounded-lg text-sm font-medium"
          style={{ background: 'var(--hytek-yellow)', color: 'var(--on-brand)', padding: '8px', border: 'none', opacity: adding || !newMark.mark_id.trim() ? .5 : 1 }}>
          Add mark
        </button>
      </div>

      {marks.length === 0 && <p className="text-sm text-center py-6" style={{ color: 'var(--text-2)' }}>No marks. Add from Tekla list.</p>}

      <div className="flex flex-col gap-1">
        {marks.map(mark => (
          <div key={mark.id} className="rounded-lg p-2 flex items-center gap-2"
            style={{ background: selected.has(mark.id) ? 'var(--chip-brand-bg)' : 'var(--surface)', border: `0.5px solid ${selected.has(mark.id) ? 'var(--hytek-yellow)' : 'var(--border)'}`, cursor: 'pointer' }}
            onClick={() => toggleSelect(mark.id)}>
            <div className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center"
              style={{ background: selected.has(mark.id) ? 'var(--hytek-yellow)' : 'var(--surface-2)', border: '0.5px solid var(--border)' }}>
              {selected.has(mark.id) && <span style={{ color: 'var(--on-brand)', fontSize: '10px' }}>✓</span>}
            </div>
            <span className="text-xs font-medium w-10 flex-shrink-0" style={{ color: 'var(--foreground)', fontWeight: 700 }}>{mark.mark_id}</span>
            <span className="text-xs flex-1 truncate" style={{ color: 'var(--text-3)' }}>{mark.section ?? '—'}</span>
            {mark.length_mm && <span className="text-xs" style={{ color: 'var(--text-2)' }}>{(mark.length_mm / 1000).toFixed(2)}m</span>}
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

  if (loading) return <p className="text-sm text-center py-6" style={{ color: 'var(--text-2)' }}>Loading…</p>
  if (drawings.length === 0)
    return (
      <div className="rounded-xl p-6 text-center" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
        <p style={{ color: 'var(--text-2)' }}>No drawings yet. Sync server uploads PDFs when Y: drive is accessible.</p>
      </div>
    )

  return (
    <div className="flex flex-col gap-2">
      {drawings.map(d => (
        <a key={d.name} href={d.url} target="_blank" rel="noopener noreferrer"
          className="rounded-xl p-3 flex items-center gap-3 no-underline"
          style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
          <span style={{ color: 'var(--hytek-yellow)', fontSize: '20px' }}>📄</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate" style={{ color: 'var(--foreground)' }}>{d.name}</p>
            {d.size && <p className="text-xs" style={{ color: 'var(--text-2)' }}>{(d.size / 1024).toFixed(0)} KB</p>}
          </div>
          <span className="text-xs" style={{ color: 'var(--foreground)', fontWeight: 700 }}>Open ↗</span>
        </a>
      ))}
    </div>
  )
}

// Shared small chip-button style for the new tabs.
const chip: React.CSSProperties = {
  background: 'transparent', border: '0.5px solid var(--border)', color: 'var(--text-3)',
  borderRadius: 999, padding: '4px 10px', fontSize: 12, cursor: 'pointer',
}

// ── Packages (contractor / treatment) ─────────────────────────────────────────
interface Pkg {
  id: string
  contractor_name: string
  scope_note: string | null
  status: string
  package_type: string
  treatment_type: string | null
  expected_return_date: string | null
  fab_marks?: { id: string }[]
}

function PackageMarkPicker({ free, onAdd }: { free: FabMark[]; onAdd: (ids: string[]) => void }) {
  const [sel, setSel] = useState<string[]>([])
  return (
    <div className="flex gap-2 items-start">
      <select multiple value={sel} onChange={e => setSel(Array.from(e.target.selectedOptions, o => o.value))}
        className="text-xs flex-1" style={{ minHeight: 70, background: 'var(--surface-2)', color: 'var(--text-3)', border: '0.5px solid var(--border)', borderRadius: 6 }}>
        {free.map(m => <option key={m.id} value={m.id}>{m.mark_id}{m.section ? ` · ${m.section}` : ''}</option>)}
      </select>
      <button onClick={() => { onAdd(sel); setSel([]) }} disabled={!sel.length} style={{ ...chip, opacity: sel.length ? 1 : .5 }}>Add</button>
    </div>
  )
}

function PackagesTab({ jobId, token }: { jobId: string; token: string }) {
  const [packages, setPackages] = useState<Pkg[]>([])
  const [marks, setMarks] = useState<FabMark[]>([])
  const [form, setForm] = useState({ contractor_name: '', package_type: 'fabrication', treatment_type: '', scope_note: '' })
  const [creating, setCreating] = useState(false)

  const authJson = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const load = useCallback(async () => {
    const [pRes, mRes] = await Promise.all([
      fetch(`/api/fab/jobs/${jobId}/contractor-packages`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`/api/fab/jobs/${jobId}/marks`, { headers: { Authorization: `Bearer ${token}` } }),
    ])
    if (pRes.ok) setPackages((await pRes.json()).packages ?? [])
    if (mRes.ok) setMarks((await mRes.json()).marks ?? [])
  }, [jobId, token])

  useEffect(() => { load() }, [load])

  async function create() {
    if (!form.contractor_name.trim()) return
    setCreating(true)
    await fetch(`/api/fab/jobs/${jobId}/contractor-packages`, {
      method: 'POST', headers: authJson,
      body: JSON.stringify({
        contractor_name: form.contractor_name.trim(),
        package_type: form.package_type,
        treatment_type: form.package_type === 'treatment' ? (form.treatment_type || null) : null,
        scope_note: form.scope_note.trim() || null,
      }),
    })
    setForm({ contractor_name: '', package_type: 'fabrication', treatment_type: '', scope_note: '' })
    setCreating(false)
    load()
  }

  async function setStatus(pkgId: string, status: string) {
    await fetch(`/api/fab/contractor-packages/${pkgId}`, { method: 'PATCH', headers: authJson, body: JSON.stringify({ status }) })
    load()
  }

  async function logCall(pkgId: string) {
    const note = prompt('What did they say?')
    if (!note) return
    const pct = prompt('Reported % (optional)')
    await fetch(`/api/fab/contractor-packages/${pkgId}/updates`, {
      method: 'POST', headers: authJson,
      body: JSON.stringify({ note, reported_pct: pct ? Number(pct) : null }),
    })
    load()
  }

  async function assignMarks(pkgId: string, add: string[]) {
    if (!add.length) return
    await fetch(`/api/fab/contractor-packages/${pkgId}/marks`, { method: 'POST', headers: authJson, body: JSON.stringify({ add }) })
    load()
  }
  async function removeMark(pkgId: string, markId: string) {
    await fetch(`/api/fab/contractor-packages/${pkgId}/marks`, { method: 'POST', headers: authJson, body: JSON.stringify({ remove: [markId] }) })
    load()
  }

  // Free marks: not in any package, in a state eligible to send out.
  const free = marks.filter(m => !m.contractor_package_id && ['not_started', 'done', 'qc_passed'].includes(m.status))

  return (
    <div>
      <div className="rounded-xl p-3 mb-3" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
        <p className="text-xs mb-2" style={{ color: 'var(--text-2)' }}>New contractor / treatment package</p>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <input placeholder="Contractor name" value={form.contractor_name} onChange={e => setForm(f => ({ ...f, contractor_name: e.target.value }))} />
          <select value={form.package_type} onChange={e => setForm(f => ({ ...f, package_type: e.target.value }))}>
            <option value="fabrication">Fabrication / CNC</option>
            <option value="treatment">Treatment</option>
            <option value="other">Other</option>
          </select>
          {form.package_type === 'treatment' && (
            <select value={form.treatment_type} onChange={e => setForm(f => ({ ...f, treatment_type: e.target.value }))}>
              <option value="">Treatment type…</option>
              <option value="hdg">HDG</option>
              <option value="etch_primer">Etch primer</option>
              <option value="powder_coat">Powder coat</option>
              <option value="two_pack">Two-pack</option>
            </select>
          )}
          <input placeholder="Scope (e.g. CNC base plates)" value={form.scope_note} onChange={e => setForm(f => ({ ...f, scope_note: e.target.value }))} />
        </div>
        <button onClick={create} disabled={creating || !form.contractor_name.trim()} className="w-full rounded-lg text-sm font-medium"
          style={{ background: 'var(--hytek-yellow)', color: 'var(--on-brand)', padding: '8px', border: 'none', opacity: creating || !form.contractor_name.trim() ? .5 : 1 }}>
          Create package
        </button>
      </div>

      {packages.length === 0 && <p className="text-sm text-center py-6" style={{ color: 'var(--text-2)' }}>No packages yet.</p>}

      <div className="flex flex-col gap-2">
        {packages.map(p => {
          const mine = marks.filter(m => m.contractor_package_id === p.id)
          return (
            <div key={p.id} className="rounded-xl p-3" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
              <div className="flex justify-between items-start gap-2">
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>{p.contractor_name}{p.scope_note ? ` — ${p.scope_note}` : ''}</p>
                  <p className="text-xs" style={{ color: 'var(--text-2)' }}>{mine.length} marks · {p.package_type}{p.treatment_type ? ` / ${p.treatment_type}` : ''}</p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ border: '0.5px solid var(--hytek-yellow)', color: 'var(--foreground)', fontWeight: 700 }}>{p.status}</span>
              </div>
              <div className="flex gap-2 mt-2 flex-wrap">
                {p.status === 'pending' && <button onClick={() => setStatus(p.id, 'sent')} style={chip}>Mark sent</button>}
                {(p.status === 'sent' || p.status === 'in_progress') && <button onClick={() => setStatus(p.id, 'returned')} style={chip}>Mark returned</button>}
                {p.status === 'returned' && <button onClick={() => setStatus(p.id, 'inspected')} style={chip}>Mark inspected</button>}
                <button onClick={() => logCall(p.id)} style={chip}>Log call</button>
              </div>
              <details className="mt-2">
                <summary className="text-xs" style={{ color: 'var(--text-2)', cursor: 'pointer' }}>Assign marks ({mine.length})</summary>
                <div className="mt-2">
                  <PackageMarkPicker free={free} onAdd={(ids) => assignMarks(p.id, ids)} />
                  <div className="flex flex-wrap gap-1 mt-2">
                    {mine.map(m => (
                      <span key={m.id} className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1" style={{ border: '0.5px solid var(--border)', color: 'var(--text-3)' }}>
                        {m.mark_id} ({m.status})
                        <button onClick={() => removeMark(p.id, m.id)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0 }}>✕</button>
                      </span>
                    ))}
                  </div>
                </div>
              </details>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── QC ─────────────────────────────────────────────────────────────────────────
function QCTab({ jobId, token }: { jobId: string; token: string }) {
  const [marks, setMarks] = useState<FabMark[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const authJson = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const load = useCallback(async () => {
    const res = await fetch(`/api/fab/jobs/${jobId}/marks`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) setMarks((await res.json()).marks ?? [])
  }, [jobId, token])
  useEffect(() => { load() }, [load])

  const pending = marks.filter(m => m.status === 'done' || m.status === 'returned')
  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  async function approve() {
    if (!selected.size) return
    await fetch(`/api/fab/jobs/${jobId}/qc`, { method: 'POST', headers: authJson, body: JSON.stringify({ mark_ids: Array.from(selected), result: 'pass' }) })
    setSelected(new Set()); load()
  }
  async function reject(markId: string) {
    const defect = prompt('Defect description (required)')
    if (!defect) return
    const rt = prompt('Rework type: inhouse or contractor', 'inhouse')
    await fetch(`/api/fab/jobs/${jobId}/qc`, {
      method: 'POST', headers: authJson,
      body: JSON.stringify({ mark_ids: [markId], result: 'fail', defect_note: defect, rework_type: rt === 'contractor' ? 'contractor' : 'inhouse' }),
    })
    load()
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <span className="text-xs" style={{ color: 'var(--text-2)' }}>{pending.length} awaiting QC</span>
        <button onClick={approve} disabled={!selected.size} className="text-xs px-3 py-1.5 rounded-lg font-medium"
          style={{ background: selected.size ? 'var(--success)' : 'var(--surface)', color: selected.size ? 'var(--foreground)' : 'var(--text-2)', border: 'none' }}>
          Approve selected ({selected.size})
        </button>
      </div>
      {pending.length === 0 && <p className="text-sm text-center py-6" style={{ color: 'var(--text-2)' }}>Nothing awaiting QC.</p>}
      <div className="flex flex-col gap-1">
        {pending.map(m => (
          <div key={m.id} className="rounded-lg p-2 flex items-center gap-2" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
            <div onClick={() => toggle(m.id)} className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center" style={{ background: selected.has(m.id) ? 'var(--hytek-yellow)' : 'var(--surface-2)', border: '0.5px solid var(--border)', cursor: 'pointer' }}>
              {selected.has(m.id) && <span style={{ color: 'var(--on-brand)', fontSize: 10 }}>✓</span>}
            </div>
            <span className="text-xs font-medium w-10 flex-shrink-0" style={{ color: 'var(--foreground)', fontWeight: 700 }}>{m.mark_id}</span>
            <span className="text-xs flex-1" style={{ color: 'var(--text-3)' }}>{m.status}{m.rework_count > 0 ? ` · rework ${m.rework_count}×` : ''}{m.rework_note ? ` — ${m.rework_note}` : ''}</span>
            <button onClick={() => reject(m.id)} style={chip}>Reject</button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Dispatch ───────────────────────────────────────────────────────────────────
interface Load {
  id: string
  load_number: number
  description: string | null
  dispatched_at: string | null
  fab_marks?: { id: string }[]
}

function DispatchTab({ jobId, token }: { jobId: string; token: string }) {
  const [marks, setMarks] = useState<FabMark[]>([])
  const [loads, setLoads] = useState<Load[]>([])
  const [desc, setDesc] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const authJson = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const load = useCallback(async () => {
    const [mRes, lRes] = await Promise.all([
      fetch(`/api/fab/jobs/${jobId}/marks`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`/api/fab/jobs/${jobId}/dispatch-loads`, { headers: { Authorization: `Bearer ${token}` } }),
    ])
    if (mRes.ok) setMarks((await mRes.json()).marks ?? [])
    if (lRes.ok) setLoads((await lRes.json()).loads ?? [])
  }, [jobId, token])
  useEffect(() => { load() }, [load])

  const ready = marks.filter(m => m.status === 'qc_passed' && !m.dispatch_load_id)
  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  async function createLoad() {
    await fetch(`/api/fab/jobs/${jobId}/dispatch-loads`, { method: 'POST', headers: authJson, body: JSON.stringify({ description: desc.trim() || null }) })
    setDesc(''); load()
  }
  async function assign(loadId: string) {
    if (!selected.size) return
    await fetch(`/api/fab/dispatch-loads/${loadId}`, { method: 'PATCH', headers: authJson, body: JSON.stringify({ add: Array.from(selected) }) })
    setSelected(new Set()); load()
  }
  async function dispatchLoad(loadId: string) {
    const driver = prompt('Driver (optional)') ?? ''
    await fetch(`/api/fab/dispatch-loads/${loadId}`, { method: 'PATCH', headers: authJson, body: JSON.stringify({ dispatched: true, driver }) })
    load()
  }

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <input placeholder="New load description" value={desc} onChange={e => setDesc(e.target.value)} className="flex-1" />
        <button onClick={createLoad} style={chip}>New load</button>
      </div>

      <p className="text-xs mb-2" style={{ color: 'var(--text-2)' }}>Ready to load — QC passed ({ready.length})</p>
      <div className="flex flex-wrap gap-1 mb-4">
        {ready.length === 0 && <span className="text-xs" style={{ color: 'var(--text-2)' }}>No QC-passed marks waiting.</span>}
        {ready.map(m => (
          <button key={m.id} onClick={() => toggle(m.id)} className="text-xs px-2 py-1 rounded-full"
            style={{ background: selected.has(m.id) ? 'var(--chip-brand-bg)' : 'transparent', border: `0.5px solid ${selected.has(m.id) ? 'var(--hytek-yellow)' : 'var(--border)'}`, color: selected.has(m.id) ? 'var(--foreground)' : 'var(--text-3)', fontWeight: selected.has(m.id) ? 700 : 400 }}>
            {m.mark_id}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {loads.map(l => (
          <div key={l.id} className="rounded-xl p-3" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
            <div className="flex justify-between items-center">
              <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>Load {l.load_number}{l.description ? ` — ${l.description}` : ''}</p>
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ border: `0.5px solid ${l.dispatched_at ? 'var(--success)' : 'var(--border)'}`, color: l.dispatched_at ? 'var(--success)' : 'var(--text-2)' }}>
                {l.dispatched_at ? `dispatched ${l.dispatched_at.slice(0, 10)}` : 'pending'}
              </span>
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--text-2)' }}>{l.fab_marks?.length ?? 0} marks</p>
            {!l.dispatched_at && (
              <div className="flex gap-2 mt-2">
                <button onClick={() => assign(l.id)} disabled={!selected.size} style={{ ...chip, opacity: selected.size ? 1 : .5 }}>Assign selected ({selected.size})</button>
                <button onClick={() => dispatchLoad(l.id)} style={{ ...chip, borderColor: 'var(--success)', color: 'var(--success)' }}>Mark dispatched</button>
              </div>
            )}
          </div>
        ))}
        {loads.length === 0 && <p className="text-sm text-center py-4" style={{ color: 'var(--text-2)' }}>No loads yet.</p>}
      </div>
    </div>
  )
}

// ── Time log ──────────────────────────────────────────────────────────────────
function TimeLogTab({ jobId, token }: { jobId: string; token: string }) {
  const [entries, setEntries] = useState<FabTimeEntry[]>([])
  const [tasks, setTasks] = useState<{ id: string; description: string }[]>([])
  const [form, setForm] = useState({ worker_name: '', hours: '', work_date: new Date().toISOString().slice(0, 10), note: '', task_id: '' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const [eRes, tRes] = await Promise.all([
      fetch(`/api/fab/jobs/${jobId}/time-log`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`/api/fab/jobs/${jobId}/tasks`, { headers: { Authorization: `Bearer ${token}` } }),
    ])
    if (eRes.ok) setEntries((await eRes.json()).entries ?? [])
    if (tRes.ok) setTasks(((await tRes.json()).tasks ?? []).map((t: { id: string; description: string }) => ({ id: t.id, description: t.description })))
  }, [jobId, token])

  useEffect(() => { load() }, [load])

  async function addEntry() {
    if (!form.worker_name.trim() || !parseFloat(form.hours)) return
    setSaving(true)
    await fetch(`/api/fab/jobs/${jobId}/time-log`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_name: form.worker_name.trim(), hours: parseFloat(form.hours), work_date: form.work_date, note: form.note.trim() || null, task_id: form.task_id || null }),
    })
    setForm(f => ({ ...f, worker_name: '', hours: '', note: '', task_id: '' }))
    setSaving(false)
    load()
  }

  const totalHours = entries.reduce((s, e) => s + (e.hours ?? 0), 0)

  return (
    <div>
      <div className="rounded-xl p-3 mb-4" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div><label className="text-xs block mb-1" style={{ color: 'var(--text-2)' }}>Worker</label>
            <input placeholder="Name" value={form.worker_name} onChange={e => setForm(f => ({ ...f, worker_name: e.target.value }))} /></div>
          <div><label className="text-xs block mb-1" style={{ color: 'var(--text-2)' }}>Hours</label>
            <input type="number" min="0" step="0.5" placeholder="0" value={form.hours} onChange={e => setForm(f => ({ ...f, hours: e.target.value }))} /></div>
          <div><label className="text-xs block mb-1" style={{ color: 'var(--text-2)' }}>Date</label>
            <input type="date" value={form.work_date} onChange={e => setForm(f => ({ ...f, work_date: e.target.value }))} /></div>
          <div><label className="text-xs block mb-1" style={{ color: 'var(--text-2)' }}>Note</label>
            <input placeholder="Optional" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} /></div>
        </div>
        <div className="mb-2">
          <label className="text-xs block mb-1" style={{ color: 'var(--text-2)' }}>Task (optional — attributes the hours to the productivity matrix)</label>
          <select value={form.task_id} onChange={e => setForm(f => ({ ...f, task_id: e.target.value }))} className="w-full">
            <option value="">— general job time —</option>
            {tasks.map(t => <option key={t.id} value={t.id}>{t.description}</option>)}
          </select>
        </div>
        <button onClick={addEntry} disabled={saving || !form.worker_name.trim() || !parseFloat(form.hours)}
          className="w-full rounded-lg text-sm font-medium"
          style={{ background: 'var(--hytek-yellow)', color: 'var(--on-brand)', padding: '8px', border: 'none', opacity: saving || !form.worker_name.trim() ? .5 : 1 }}>
          Log time
        </button>
      </div>

      <div className="flex justify-between text-xs mb-2" style={{ color: 'var(--text-2)' }}>
        <span>{entries.length} entries</span>
        <span>Total: {totalHours.toFixed(1)} hrs</span>
      </div>

      <div className="flex flex-col gap-1">
        {entries.map(e => (
          <div key={e.id} className="rounded-lg p-2 flex justify-between items-center" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
            <div>
              <p className="text-sm" style={{ color: 'var(--foreground)' }}>{e.worker_name}</p>
              <p className="text-xs" style={{ color: 'var(--text-2)' }}>{e.work_date} {e.note ? `· ${e.note}` : ''}</p>
            </div>
            <span className="text-sm font-medium" style={{ color: 'var(--foreground)', fontWeight: 700 }}>{e.hours} hrs</span>
          </div>
        ))}
        {entries.length === 0 && <p className="text-sm text-center py-4" style={{ color: 'var(--text-2)' }}>No time entries yet.</p>}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { user, loading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const validTabs: Tab[] = ['tasks', 'marks', 'drawings', 'packages', 'qc', 'dispatch', 'timelog']
  const tabParam = searchParams.get('tab') as Tab | null
  const [job, setJob] = useState<JobDetail | null>(null)
  const [tab, setTab] = useState<Tab>(tabParam && validTabs.includes(tabParam) ? tabParam : 'tasks')
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
  if (!job) return <AppShell><div className="p-6 text-center" style={{ color: 'var(--text-2)' }}>Loading…</div></AppShell>

  const pct = job.tonnage_pct
  const taskPct = job.task_count ? Math.round((job.task_done / job.task_count) * 100) : 0
  const canDispatch = (role === 'admin' || role === 'supervisor') && job.status !== 'complete' && !job.dispatch_requested_at

  const TABS: { id: Tab; label: string }[] = [
    { id: 'tasks', label: 'Tasks' },
    { id: 'marks', label: 'Marks' },
    { id: 'drawings', label: 'Drawings' },
    { id: 'packages', label: 'Packages' },
    { id: 'qc', label: 'QC' },
    { id: 'dispatch', label: 'Dispatch' },
    { id: 'timelog', label: 'Time' },
  ]

  return (
    <AppShell>
      <div className="p-4 max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-4">
          <button onClick={() => router.push('/shop')} className="text-xs mb-2 block" style={{ background: 'none', border: 'none', color: 'var(--text-2)', padding: 0 }}>
            ← Shop
          </button>
          <div className="flex justify-between items-start mb-1">
            <span className="text-xs font-medium" style={{ color: 'var(--foreground)', fontWeight: 700 }}>{job.quote_number}</span>
            {job.dispatch_requested_at && (
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--chip-success-bg)', color: 'var(--success)', border: '0.5px solid var(--success)' }}>
                Dispatch ready
              </span>
            )}
          </div>
          <p className="text-base font-semibold mb-0.5" style={{ color: 'var(--foreground)' }}>{job.name}</p>
          <p className="text-xs mb-2" style={{ color: 'var(--text-2)' }}>{job.client ?? '—'} {job.on_site_date ? `· On site ${job.on_site_date}` : ''}</p>
          <div className="flex gap-4 text-xs mb-3 flex-wrap" style={{ color: 'var(--text-2)' }}>
            <span style={{ color: 'var(--foreground)' }}>{kgToTonnes(job.made_kg)} / {kgToTonnes(job.total_kg)} t · {pct}%</span>
            <span>{job.task_done}/{job.task_count} tasks ({taskPct}%)</span>
            <span>{job.mark_done}/{job.mark_count} marks</span>
            <span>{(job.total_hours ?? 0).toFixed(1)} h</span>
          </div>
          <div className="rounded-full h-1 mb-1" style={{ background: 'var(--track)' }}>
            <div className="h-full rounded-full" style={{ background: 'var(--hytek-yellow)', width: `${pct}%` }} />
          </div>
          {job.marks_missing_weight > 0 && (
            <p className="text-xs mb-3" style={{ color: 'var(--warning)' }}>
              {job.marks_missing_weight} mark(s) missing weight — tonnage may be understated
            </p>
          )}

          {canDispatch && (
            <button onClick={dispatch} disabled={dispatching} className="w-full rounded-lg text-sm font-medium"
              style={{ background: dispatching ? 'var(--border)' : 'var(--success)', color: dispatching ? 'var(--text-2)' : 'var(--foreground)', padding: '10px', border: 'none', fontWeight: 600 }}>
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
                background: tab === t.id ? 'var(--hytek-yellow)' : 'var(--surface)',
                color: tab === t.id ? 'var(--on-brand)' : 'var(--text-2)',
                border: tab === t.id ? 'none' : '0.5px solid var(--border)',
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
          {tab === 'packages' && <PackagesTab jobId={id} token={token} />}
          {tab === 'qc' && <QCTab jobId={id} token={token} />}
          {tab === 'dispatch' && <DispatchTab jobId={id} token={token} />}
          {tab === 'timelog' && <TimeLogTab jobId={id} token={token} />}
        </>}
      </div>
    </AppShell>
  )
}
