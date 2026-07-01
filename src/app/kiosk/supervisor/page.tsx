'use client'

// Supervisor panel on the tablet (kiosk session). Pick a job, run QC on
// finished marks, and update contractor packages — all via kiosk-token APIs.
// Full job setup stays on the office PC.
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

const IDLE_MS = 30 * 60 * 1000

interface Session { worker_name: string; role: string; token: string }
interface Job { id: string; quote_number: string; name: string; mark_count?: number; mark_done?: number }
interface Mark { id: string; mark_id: string; status: string; rework_count: number; rework_note: string | null; contractor_package_id: string | null }
interface Pkg { id: string; contractor_name: string; scope_note: string | null; status: string; package_type: string; treatment_type: string | null; fab_marks?: { id: string }[] }
interface Worker { id: string; worker_name: string; role: string; is_active: boolean }

export default function KioskSupervisorPage() {
  const router = useRouter()
  const [session, setSession] = useState<Session | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [active, setActive] = useState<Job | null>(null)
  const [marks, setMarks] = useState<Mark[]>([])
  const [packages, setPackages] = useState<Pkg[]>([])
  const [sel, setSel] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [workers, setWorkers] = useState<Worker[]>([])
  const [wName, setWName] = useState('')
  const [wPin, setWPin] = useState('')
  const [wRole, setWRole] = useState('fabricator')
  const [wMsg, setWMsg] = useState('')
  const [showWorkers, setShowWorkers] = useState(false)

  const signOut = useCallback(() => {
    sessionStorage.removeItem('fab_kiosk')
    router.push('/kiosk')
  }, [router])

  const authHeaders = useCallback((json = false): Record<string, string> => {
    const h: Record<string, string> = { authorization: `Bearer ${session?.token ?? ''}` }
    if (json) h['Content-Type'] = 'application/json'
    return h
  }, [session])

  useEffect(() => {
    const raw = sessionStorage.getItem('fab_kiosk')
    if (!raw) { router.push('/kiosk'); return }
    const s = JSON.parse(raw) as Session
    if (s.role !== 'supervisor' && s.role !== 'admin') { router.push('/kiosk/work'); return }
    setSession(s)
    fetch('/api/fab/jobs', { headers: { authorization: `Bearer ${s.token}` } })
      .then(r => r.status === 401 ? (signOut(), null) : r.json())
      .then(j => { if (j) { setJobs(j.jobs ?? []); setLoading(false) } })
    fetch('/api/fab/pin/workers', { headers: { authorization: `Bearer ${s.token}` } })
      .then(r => r.ok ? r.json() : { workers: [] })
      .then(j => setWorkers(j.workers ?? []))
  }, [router, signOut])

  useEffect(() => {
    let timer = setTimeout(signOut, IDLE_MS)
    const reset = () => { clearTimeout(timer); timer = setTimeout(signOut, IDLE_MS) }
    window.addEventListener('click', reset)
    window.addEventListener('touchstart', reset)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('click', reset)
      window.removeEventListener('touchstart', reset)
    }
  }, [signOut])

  const openJob = useCallback(async (job: Job) => {
    setActive(job); setSel([])
    const [mRes, pRes] = await Promise.all([
      fetch(`/api/fab/jobs/${job.id}/marks`, { headers: authHeaders() }),
      fetch(`/api/fab/jobs/${job.id}/contractor-packages`, { headers: authHeaders() }),
    ])
    const mJson = await mRes.json()
    const pJson = await pRes.json()
    setMarks(mJson.marks ?? [])
    setPackages(pJson.packages ?? [])
  }, [authHeaders])

  const refresh = useCallback(async () => { if (active) await openJob(active) }, [active, openJob])

  const pending = marks.filter(m => m.status === 'done' || m.status === 'returned')
  function toggle(id: string) {
    setSel(sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id])
  }
  async function qcPass() {
    if (!active || !sel.length) return
    await fetch(`/api/fab/jobs/${active.id}/qc`, {
      method: 'POST', headers: authHeaders(true),
      body: JSON.stringify({ mark_ids: sel, result: 'pass' }),
    })
    setSel([]); refresh()
  }
  async function qcFail(markId: string) {
    if (!active) return
    const defect = prompt('Defect description (required)')
    if (!defect) return
    const rt = prompt('Rework type: inhouse or contractor', 'inhouse')
    await fetch(`/api/fab/jobs/${active.id}/qc`, {
      method: 'POST', headers: authHeaders(true),
      body: JSON.stringify({ mark_ids: [markId], result: 'fail', defect_note: defect,
        rework_type: rt === 'contractor' ? 'contractor' : 'inhouse' }),
    })
    refresh()
  }

  async function pkgStatus(pkgId: string, status: string) {
    await fetch(`/api/fab/contractor-packages/${pkgId}`, {
      method: 'PATCH', headers: authHeaders(true), body: JSON.stringify({ status }),
    })
    refresh()
  }
  async function pkgLogCall(pkgId: string) {
    const note = prompt('What did they say?')
    if (!note) return
    const pct = prompt('Reported % (optional)')
    await fetch(`/api/fab/contractor-packages/${pkgId}/updates`, {
      method: 'POST', headers: authHeaders(true),
      body: JSON.stringify({ note, reported_pct: pct ? Number(pct) : null }),
    })
    refresh()
  }

  async function reloadWorkers() {
    const res = await fetch('/api/fab/pin/workers', { headers: authHeaders() })
    if (res.ok) setWorkers((await res.json()).workers ?? [])
  }
  async function addWorker() {
    setWMsg('')
    if (!wName.trim()) { setWMsg('Enter a name'); return }
    if (!/^\d{4}$/.test(wPin)) { setWMsg('PIN must be 4 digits'); return }
    const res = await fetch('/api/fab/pin/workers', {
      method: 'POST', headers: authHeaders(true),
      body: JSON.stringify({ worker_name: wName.trim(), pin: wPin, role: wRole }),
    })
    const j = await res.json()
    if (!res.ok) { setWMsg(j.error ?? 'Failed'); return }
    setWName(''); setWPin(''); setWRole('fabricator'); setWMsg('✓ Added')
    reloadWorkers()
  }
  async function deactivateWorker(id: string) {
    await fetch(`/api/fab/pin/workers/${id}`, { method: 'DELETE', headers: authHeaders() })
    reloadWorkers()
  }

  if (loading) return <main style={shell}><p>Loading…</p></main>

  return (
    <main style={shell}>
      <header style={hdr}>
        <h1 style={{ color: 'var(--foreground)', fontWeight: 700, margin: 0 }}>Supervisor — {session?.worker_name}</h1>
        <button onClick={signOut} style={ghostBtn}>Sign out</button>
      </header>

      {!active && (
        <>
          <p style={{ opacity: 0.7, marginBottom: 16 }}>Pick a job for QC and contractor packages. Full setup is on the office PC.</p>
          {jobs.map(j => (
            <button key={j.id} onClick={() => openJob(j)} style={jobCard}>
              <div style={{ fontWeight: 700 }}>{j.quote_number} — {j.name}</div>
              <div style={{ fontSize: 13, opacity: 0.7 }}>{(j.mark_done ?? 0)}/{(j.mark_count ?? 0)} marks complete</div>
            </button>
          ))}

          <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <button onClick={() => setShowWorkers(v => !v)} style={ghostBtn}>
              {showWorkers ? '▾' : '▸'} Workers ({workers.filter(w => w.is_active).length})
            </button>
            {showWorkers && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                  <input placeholder="Name" value={wName} onChange={e => setWName(e.target.value)} style={inp} />
                  <input placeholder="4-digit PIN" value={wPin} onChange={e => setWPin(e.target.value)} maxLength={4} inputMode="numeric" style={{ ...inp, width: 120 }} />
                  <select value={wRole} onChange={e => setWRole(e.target.value)} style={inp}>
                    <option value="fabricator">Fabricator</option>
                    <option value="supervisor">Supervisor</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button onClick={addWorker} style={{ ...primaryBtn, marginBottom: 0 }}>Add</button>
                </div>
                {wMsg && <p style={{ fontSize: 13, color: wMsg.startsWith('✓') ? 'var(--success)' : 'var(--danger)', marginBottom: 8 }}>{wMsg}</p>}
                {workers.filter(w => w.is_active).map(w => (
                  <div key={w.id} style={row}>
                    <span style={{ flex: 1 }}>{w.worker_name} <span style={{ opacity: 0.6 }}>({w.role})</span></span>
                    <button onClick={() => deactivateWorker(w.id)} style={ghostBtn}>Remove</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {active && (
        <>
          <button onClick={() => setActive(null)} style={ghostBtn}>&#x2190; All jobs</button>
          <h2 style={{ color: 'var(--foreground)', fontWeight: 700 }}>{active.quote_number} — {active.name}</h2>

          <section style={{ marginTop: 16 }}>
            <h3 style={sub}>QC review ({pending.length} awaiting)</h3>
            <button onClick={qcPass} disabled={!sel.length} style={primaryBtn}>Approve selected ({sel.length})</button>
            {pending.map(m => (
              <div key={m.id} style={row}>
                <label style={{ flex: 1 }}>
                  <input type="checkbox" checked={sel.includes(m.id)} onChange={() => toggle(m.id)} />{' '}
                  {m.mark_id} <span style={{ opacity: 0.6 }}>({m.status})</span>
                  {m.rework_count > 0 && <span style={{ color: 'var(--warning)' }}> &middot; rework {m.rework_count}&times;</span>}
                </label>
                <button onClick={() => qcFail(m.id)} style={ghostBtn}>Reject</button>
              </div>
            ))}
          </section>

          <section style={{ marginTop: 24 }}>
            <h3 style={sub}>Contractor packages ({packages.length})</h3>
            {packages.map(p => (
              <div key={p.id} style={pkgCard}>
                <div style={{ fontWeight: 700 }}>
                  {p.contractor_name}{p.scope_note ? ` — ${p.scope_note}` : ''} <span style={{ opacity: 0.6 }}>({p.status})</span>
                </div>
                <div style={{ fontSize: 13, opacity: 0.7 }}>
                  {(p.fab_marks?.length ?? 0)} marks &middot; {p.package_type}{p.treatment_type ? ` / ${p.treatment_type}` : ''}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  {p.status === 'pending' && <button onClick={() => pkgStatus(p.id, 'sent')} style={ghostBtn}>Mark sent</button>}
                  {(p.status === 'sent' || p.status === 'in_progress') && <button onClick={() => pkgStatus(p.id, 'returned')} style={ghostBtn}>Mark returned</button>}
                  {p.status === 'returned' && <button onClick={() => pkgStatus(p.id, 'inspected')} style={ghostBtn}>Mark inspected</button>}
                  <button onClick={() => pkgLogCall(p.id)} style={ghostBtn}>Log call</button>
                </div>
              </div>
            ))}
          </section>
        </>
      )}
    </main>
  )
}

const shell: React.CSSProperties = { minHeight: '100vh', background: 'var(--background)', color: 'var(--foreground)', padding: 24, fontFamily: 'system-ui, sans-serif' }
const hdr: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }
const sub: React.CSSProperties = { color: 'var(--foreground)', fontWeight: 700, fontSize: 16 }
const jobCard: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'left', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 12, color: 'var(--foreground)', cursor: 'pointer' }
const pkgCard: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, marginBottom: 12 }
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border)' }
const primaryBtn: React.CSSProperties = { background: 'var(--hytek-yellow)', color: 'var(--on-brand)', border: 'none', borderRadius: 10, padding: '10px 18px', fontWeight: 700, cursor: 'pointer', marginBottom: 12 }
const ghostBtn: React.CSSProperties = { background: 'transparent', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 14px', cursor: 'pointer' }
const inp: React.CSSProperties = { background: 'var(--surface-2)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 14 }
