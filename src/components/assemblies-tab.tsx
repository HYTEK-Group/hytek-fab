'use client'

// The supervisor's assign surface — the assembly IS the unit of work. Every
// assembly from the drawings, with its tonnes and a learned time suggestion; tap
// one to see its drawing and assign a worker + time (suggested, editable); or tick
// several and assign them together.
import { useCallback, useEffect, useState } from 'react'

interface Suggestion { minutes: number; basis: string; confidence: 'low' | 'medium' | 'good'; samples: number }
interface Assembly {
  id: string; mark_id: string; description: string | null; section: string | null
  weight_kg: number | null; quantity: number
  status: string; assigned_to: string | null; allotted_minutes: number | null
  actual_minutes: number | null; suggestion: Suggestion
}

const tonnesOf = (m: Assembly) => Math.round((Math.max(0, m.weight_kg ?? 0) * (m.quantity ?? 1)) / 10) / 100
const hrs = (min: number | null | undefined) => (min == null ? '—' : `${Math.round((min / 60) * 10) / 10} h`)
const confColor = (c: Suggestion['confidence']) => (c === 'good' ? 'var(--success)' : c === 'medium' ? 'var(--warning)' : 'var(--text-3)')

export function AssembliesTab({ jobId, token }: { jobId: string; token: string; role: string }) {
  const [rows, setRows] = useState<Assembly[]>([])
  const [workers, setWorkers] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [panel, setPanel] = useState<{ ids: string[] } | null>(null)
  const [worker, setWorker] = useState('')
  const [hoursStr, setHoursStr] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/fab/jobs/${jobId}/assemblies`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) { const j = await res.json(); setRows(j.assemblies ?? []); setWorkers(j.workers ?? []) }
    setLoading(false)
  }, [jobId, token])
  useEffect(() => { load() }, [load])

  const toggle = (id: string) => setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  function openPanel(ids: string[]) {
    const marks = rows.filter(r => ids.includes(r.id))
    if (!marks.length) return
    const first = marks[0]
    setWorker(first.assigned_to ?? '')
    // pre-fill with the (existing allotted, else the average suggestion)
    const mins = first.allotted_minutes ?? Math.round(marks.reduce((s, m) => s + m.suggestion.minutes, 0) / marks.length)
    setHoursStr(String(Math.round((mins / 60) * 100) / 100))
    setPanel({ ids })
  }

  async function openDrawing(id: string) {
    const res = await fetch(`/api/fab/marks/${id}/drawing`, { headers: { Authorization: `Bearer ${token}` } })
    const j = await res.json().catch(() => ({}))
    if (res.ok && j.url) window.open(j.url, '_blank', 'noopener')
    else alert(j.error ?? 'No drawing found for this job yet')
  }

  async function assign() {
    if (!panel || !worker || !hoursStr) return
    const minutes = Math.round(parseFloat(hoursStr) * 60)
    if (!(minutes > 0)) return
    setBusy(true)
    const suggested = panel.ids.length === 1 ? rows.find(r => r.id === panel.ids[0])?.suggestion.minutes ?? null : null
    const res = await fetch(`/api/fab/jobs/${jobId}/assign`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mark_ids: panel.ids, assigned_to: worker, allotted_minutes: minutes, suggested_minutes: suggested }),
    })
    setBusy(false)
    if (res.ok) { setPanel(null); setSelected(new Set()); load() }
    else alert((await res.json().catch(() => ({}))).error ?? 'Assign failed')
  }

  if (loading) return <p className="text-sm text-center py-6" style={{ color: 'var(--text-2)' }}>Loading assemblies…</p>
  if (rows.length === 0) return <p className="text-sm text-center py-6" style={{ color: 'var(--text-2)' }}>No assemblies yet — import the Tekla Assembly List on the Marks tab.</p>

  const panelMarks = panel ? rows.filter(r => panel.ids.includes(r.id)) : []

  return (
    <div style={{ paddingBottom: selected.size ? 64 : 0 }}>
      <p className="text-xs mb-2" style={{ color: 'var(--text-2)' }}>Tap an assembly to open its drawing and assign time. Tick several to assign together.</p>

      <div className="flex flex-col gap-2">
        {rows.map(m => {
          const sel = selected.has(m.id)
          const done = m.status === 'done' || m.status === 'qc_passed'
          return (
            <div key={m.id} className="rounded-xl p-3 flex items-center gap-2"
              style={{ background: 'var(--surface)', border: sel ? '1.5px solid var(--hytek-yellow)' : '0.5px solid var(--border)' }}>
              <button onClick={() => toggle(m.id)} aria-label="select" className="flex-shrink-0"
                style={{ width: 22, height: 22, borderRadius: 6, border: `1.5px solid ${sel ? 'var(--warning)' : 'var(--border)'}`, background: sel ? 'var(--chip-brand-bg)' : 'transparent', color: 'var(--warning)', fontWeight: 700, lineHeight: '18px' }}>
                {sel ? '✓' : ''}
              </button>
              <button onClick={() => openPanel([m.id])} className="flex-1 text-left">
                <p className="text-sm" style={{ color: 'var(--foreground)', fontWeight: 500 }}>{m.mark_id} · {m.section ?? '—'}</p>
                <p className="text-xs" style={{ color: 'var(--text-2)' }}>
                  {tonnesOf(m)} t · qty {m.quantity}
                  {done && <span style={{ color: 'var(--success)' }}> · done {hrs(m.actual_minutes)}</span>}
                </p>
              </button>
              <button onClick={() => openDrawing(m.id)} className="text-xs px-2 py-1 rounded-lg flex-shrink-0"
                style={{ color: 'var(--info)', border: '0.5px solid var(--border)', background: 'transparent' }}>drawing</button>
              {m.assigned_to ? (
                <div className="text-right flex-shrink-0" style={{ minWidth: 78 }}>
                  <p className="text-xs" style={{ color: 'var(--success)', fontWeight: 500 }}>{m.assigned_to}</p>
                  <p className="text-xs" style={{ color: 'var(--text-2)' }}>{hrs(m.allotted_minutes)}</p>
                </div>
              ) : (
                <button onClick={() => openPanel([m.id])} className="text-xs px-2 py-1 rounded-lg flex-shrink-0"
                  style={{ background: 'var(--hytek-yellow)', color: 'var(--on-brand)', fontWeight: 500, border: 'none' }}>
                  {hrs(m.suggestion.minutes)} →
                </button>
              )}
            </div>
          )
        })}
      </div>

      {selected.size > 0 && !panel && (
        <div className="fixed left-0 right-0 flex items-center justify-between px-4 py-3" style={{ bottom: 52, background: 'var(--foreground)' }}>
          <span className="text-sm" style={{ color: '#fff' }}>{selected.size} selected</span>
          <button onClick={() => openPanel(Array.from(selected))} className="text-sm px-4 py-2 rounded-lg font-medium"
            style={{ background: 'var(--hytek-yellow)', color: 'var(--on-brand)', border: 'none' }}>Assign →</button>
        </div>
      )}

      {panel && (
        <div className="fixed inset-0 flex items-end justify-center" style={{ background: 'rgba(0,0,0,.4)', zIndex: 50 }} onClick={() => setPanel(null)}>
          <div className="w-full max-w-md rounded-t-2xl p-4" style={{ background: 'var(--background)' }} onClick={e => e.stopPropagation()}>
            <p className="text-sm mb-1" style={{ color: 'var(--foreground)', fontWeight: 600 }}>
              Assign {panelMarks.length === 1 ? panelMarks[0].mark_id : `${panelMarks.length} assemblies`}
            </p>
            <p className="text-xs mb-3" style={{ color: 'var(--text-2)' }}>
              {panelMarks.length === 1 ? `${panelMarks[0].section ?? ''} · ` : ''}
              {Math.round(panelMarks.reduce((s, m) => s + tonnesOf(m), 0) * 100) / 100} t
            </p>

            {panelMarks.length === 1 && (
              <button onClick={() => openDrawing(panelMarks[0].id)} className="w-full text-sm py-2 rounded-lg mb-3"
                style={{ color: 'var(--info)', border: '0.5px solid var(--border)', background: 'var(--surface)' }}>📐 Open the drawing for {panelMarks[0].mark_id}</button>
            )}

            <p className="text-xs mb-1" style={{ color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Who</p>
            <div className="flex gap-2 flex-wrap mb-3">
              {workers.map(w => (
                <button key={w} onClick={() => setWorker(w)} className="text-sm px-3 py-1.5 rounded-full"
                  style={worker === w ? { background: 'var(--foreground)', color: '#fff', border: 'none' } : { background: 'transparent', color: 'var(--foreground)', border: '0.5px solid var(--border)' }}>{w}</button>
              ))}
              {workers.length === 0 && <span className="text-xs" style={{ color: 'var(--text-3)' }}>No workers yet — add them on the Workers screen.</span>}
            </div>

            <p className="text-xs mb-1" style={{ color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Allotted time (hours){panelMarks.length > 1 ? ' — each' : ''}</p>
            <input type="number" min="0" step="0.25" value={hoursStr} onChange={e => setHoursStr(e.target.value)} className="mb-1" />
            {panelMarks.length === 1 && (
              <p className="text-xs mb-3" style={{ color: confColor(panelMarks[0].suggestion.confidence) }}>
                💡 suggested {hrs(panelMarks[0].suggestion.minutes)} — {panelMarks[0].suggestion.basis}
              </p>
            )}

            <div className="flex gap-2 mt-2">
              <button onClick={() => setPanel(null)} className="flex-1 text-sm py-3 rounded-lg" style={{ background: 'var(--surface)', color: 'var(--text-2)', border: '0.5px solid var(--border)' }}>Cancel</button>
              <button onClick={assign} disabled={busy || !worker || !hoursStr} className="flex-1 text-sm py-3 rounded-lg font-medium"
                style={{ background: 'var(--hytek-yellow)', color: 'var(--on-brand)', border: 'none', opacity: busy || !worker || !hoursStr ? 0.5 : 1 }}>
                {busy ? 'Assigning…' : 'Assign & go'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
