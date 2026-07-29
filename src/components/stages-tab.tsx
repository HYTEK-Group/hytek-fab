'use client'

// Delivery Stages — carve a job's pieces into staged deliveries (pieces +
// on-site date + build order), each with its own "everything photographed"
// gate. Fab owns this plan; it flows to Troy's board via the bridge. The office
// creates stages and drags unstaged pieces into them.
import { useCallback, useEffect, useState } from 'react'

interface Piece { id: string; mark_id: string; section: string | null; weight_kg: number | null; quantity: number; status: string; made: boolean }
interface Completeness { total: number; made: number; missing_marks: string[]; ready: boolean }
interface Stage {
  id: string; stage_ref: string; name: string; required_on_site_date: string | null; sequence_no: number
  marks: Piece[]; tonnes: number; completeness: Completeness
}

const card: React.CSSProperties = { background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 12, padding: 14, marginBottom: 12 }
const chip = (bg: string, fg: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: bg, color: fg })
const d = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' }) : '—')

export function StagesTab({ jobId, token, role }: { jobId: string; token: string; role: string }) {
  const isSup = role === 'admin' || role === 'supervisor'
  const [stages, setStages] = useState<Stage[]>([])
  const [unstaged, setUnstaged] = useState<Piece[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [form, setForm] = useState({ name: '', date: '' })
  const [assignTo, setAssignTo] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const authJson = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const load = useCallback(async () => {
    const res = await fetch(`/api/fab/jobs/${jobId}/stages`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) { const j = await res.json(); setStages(j.stages ?? []); setUnstaged(j.unstaged ?? []) }
    setLoading(false)
  }, [jobId, token])

  useEffect(() => {
    let stale = false
    ;(async () => { await Promise.resolve(); if (!stale) load() })()
    return () => { stale = true }
  }, [load])

  async function createStage() {
    if (!form.name.trim()) return
    setBusy('create')
    await fetch(`/api/fab/jobs/${jobId}/stages`, { method: 'POST', headers: authJson, body: JSON.stringify({ name: form.name.trim(), required_on_site_date: form.date || null }) })
    setForm({ name: '', date: '' }); setBusy(''); load()
  }
  async function patchStage(id: string, patch: object) {
    setBusy(id)
    await fetch(`/api/fab/stages/${id}`, { method: 'PATCH', headers: authJson, body: JSON.stringify(patch) })
    setBusy(''); load()
  }
  async function deleteStage(id: string) {
    if (!confirm('Delete this stage? Its pieces become unstaged (nothing is lost).')) return
    setBusy(id)
    await fetch(`/api/fab/stages/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    setBusy(''); load()
  }
  async function assignPicked(stageId: string) {
    if (picked.size === 0) return
    setBusy(stageId)
    await fetch(`/api/fab/stages/${stageId}/marks`, { method: 'POST', headers: authJson, body: JSON.stringify({ add: Array.from(picked) }) })
    setPicked(new Set()); setAssignTo(null); setBusy(''); load()
  }
  async function removePiece(stageId: string, markId: string) {
    setBusy(stageId + markId)
    await fetch(`/api/fab/stages/${stageId}/marks`, { method: 'POST', headers: authJson, body: JSON.stringify({ remove: [markId] }) })
    setBusy(''); load()
  }
  const togglePick = (id: string) => setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  if (loading) return <p className="text-sm" style={{ color: 'var(--text-2)' }}>Loading…</p>

  return (
    <div>
      <p className="text-xs mb-3" style={{ color: 'var(--text-2)' }}>
        Break the job into delivery stages in the order the install team wants it on site. Each stage needs every piece photographed before it can go.
      </p>

      {isSup && (
        <div style={{ ...card, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input placeholder="New stage — e.g. Ground floor columns" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={{ flex: 1, minWidth: 180 }} />
          <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={{ width: 150 }} title="on site by" />
          <button onClick={createStage} disabled={busy === 'create' || !form.name.trim()} className="px-4 rounded-lg text-sm font-medium" style={{ background: 'var(--hytek-yellow)', color: 'var(--on-brand)', border: 'none', opacity: !form.name.trim() ? 0.5 : 1 }}>Add stage</button>
        </div>
      )}

      {stages.length === 0 && <p className="text-sm text-center py-6" style={{ color: 'var(--text-2)' }}>No stages yet — the whole job delivers as one.</p>}

      {stages.map(s => (
        <div key={s.id} style={card}>
          <div className="flex items-center justify-between gap-2 flex-wrap" style={{ marginBottom: 8 }}>
            <div className="flex items-center gap-2 flex-wrap">
              <span style={{ fontWeight: 700, color: 'var(--foreground)' }}>{s.sequence_no}. {s.name}</span>
              <span style={chip('var(--surface-2)', 'var(--text-2)')}>on site {d(s.required_on_site_date)}</span>
              <span style={chip('var(--surface-2)', 'var(--text-2)')}>{s.tonnes} t</span>
            </div>
            <div className="flex items-center gap-2">
              {s.completeness.total === 0
                ? <span style={chip('var(--surface-2)', 'var(--text-2)')}>no pieces yet</span>
                : s.completeness.ready
                  ? <span style={chip('var(--chip-success-bg, rgba(21,128,61,.1))', 'var(--success)')}>✓ {s.completeness.made}/{s.completeness.total} photographed — ready</span>
                  : <span style={chip('var(--surface-2)', 'var(--warning, #9a6206)')}>🔒 {s.completeness.made}/{s.completeness.total} — missing {s.completeness.missing_marks.slice(0, 6).join(', ')}{s.completeness.missing_marks.length > 6 ? '…' : ''}</span>}
              {isSup && <button onClick={() => deleteStage(s.id)} disabled={busy === s.id} className="text-xs px-2 py-1 rounded" style={{ color: 'var(--danger)', background: 'transparent', border: '0.5px solid var(--border)' }}>Delete</button>}
            </div>
          </div>

          {isSup && (
            <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
              <input type="date" value={s.required_on_site_date ?? ''} onChange={e => patchStage(s.id, { required_on_site_date: e.target.value || null })} style={{ width: 150, fontSize: 12 }} title="on site by" />
              <button onClick={() => { setAssignTo(assignTo === s.id ? null : s.id); setPicked(new Set()) }} className="text-xs px-3 py-1 rounded" style={{ background: 'transparent', border: '0.5px solid var(--border)', color: 'var(--foreground)' }}>
                {assignTo === s.id ? 'Close' : '+ Add pieces'}
              </button>
            </div>
          )}

          {/* piece picker */}
          {assignTo === s.id && (
            <div style={{ ...card, marginBottom: 8, background: 'var(--surface-2)' }}>
              {unstaged.length === 0 ? <p className="text-xs" style={{ color: 'var(--text-3)' }}>No unstaged pieces left.</p> : (
                <>
                  <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                    {unstaged.map(p => (
                      <label key={p.id} className="flex items-center gap-2" style={{ padding: '5px 0', fontSize: 13, cursor: 'pointer' }}>
                        <input type="checkbox" checked={picked.has(p.id)} onChange={() => togglePick(p.id)} />
                        <b>{p.mark_id}</b> · {p.section ?? ''} {p.made && <span style={chip('var(--chip-success-bg, rgba(21,128,61,.1))', 'var(--success)')}>photographed</span>}
                      </label>
                    ))}
                  </div>
                  <button onClick={() => assignPicked(s.id)} disabled={picked.size === 0 || busy === s.id} className="text-xs px-3 py-1.5 rounded font-medium mt-2" style={{ background: 'var(--hytek-yellow)', color: 'var(--on-brand)', border: 'none', opacity: picked.size === 0 ? 0.5 : 1 }}>
                    Add {picked.size} piece{picked.size === 1 ? '' : 's'} to stage
                  </button>
                </>
              )}
            </div>
          )}

          {/* pieces in this stage */}
          {s.marks.length === 0
            ? <p className="text-xs" style={{ color: 'var(--text-3)' }}>No pieces assigned yet.</p>
            : s.marks.map(p => (
              <div key={p.id} className="flex items-center justify-between" style={{ padding: '6px 0', borderTop: '0.5px solid var(--border)', fontSize: 13 }}>
                <span><b>{p.mark_id}</b> · {p.section ?? ''}</span>
                <div className="flex items-center gap-2">
                  {p.made ? <span style={{ color: 'var(--success)' }}>📷 made</span> : <span style={{ color: 'var(--warning, #9a6206)' }}>no photo</span>}
                  {isSup && <button onClick={() => removePiece(s.id, p.id)} disabled={busy === s.id + p.id} className="text-xs px-2 py-0.5 rounded" style={{ color: 'var(--text-2)', background: 'transparent', border: '0.5px solid var(--border)' }}>remove</button>}
                </div>
              </div>
            ))}
        </div>
      ))}

      {unstaged.length > 0 && (
        <p className="text-xs" style={{ color: 'var(--text-3)', marginTop: 8 }}>
          {unstaged.length} piece{unstaged.length === 1 ? '' : 's'} not in any stage yet — use “+ Add pieces” on a stage to place them.
        </p>
      )}
    </div>
  )
}
