'use client'

// Subcontractor PWA — a phone app for an external fabricator working our steel.
// One screen per granted package: see the pieces, photograph each one as it's made,
// photograph the whole load at each stage (coating out/back, bundled, loaded),
// attach certs, report progress, and hit "Ready to collect" when it's done.
// PIN sign-in per contractor link (/sub/<slug>); first visit sets the PIN.
import { useCallback, useEffect, useState, use } from 'react'

const YELLOW = 'var(--hytek-yellow)'
const STORE_KEY = 'fab_sub'

type Mode = 'loading' | 'login' | 'setup' | 'work'
type Stage = 'made' | 'treatment_out' | 'treatment_in' | 'bundled' | 'loaded'
type CertKind = 'qa' | 'weld' | 'mill' | 'coating' | 'itp' | 'other'

interface Piece {
  id: string; mark_id: string; description: string | null; section: string | null
  length_mm: number | null; weight_kg: number | null; quantity: number
  made: boolean; made_at: string | null
}
interface Cert { id: string; kind: CertKind; file_name: string; note: string | null; uploaded_at: string }
interface ProgressUpdate { logged_at: string; note: string; reported_pct: number | null; eta: string | null }
interface Pkg {
  package_id: string
  job: { quote_number: string | null; name: string | null; on_site_date: string | null }
  delivery_mode: 'return_to_brisbane' | 'drop_ship'
  status: string
  ready_at: string | null
  expected_return_date: string | null
  scope_note: string | null
  treatment_type: string | null
  pieces: Piece[]
  made_count: number
  total_pieces: number
  stage_counts: { made: number; treatment_out: number; treatment_in: number; bundled: number; loaded: number }
  certs: Cert[]
  recent_updates: ProgressUpdate[]
}

const CERT_KINDS: { value: CertKind; label: string }[] = [
  { value: 'qa', label: 'QA sign-off' },
  { value: 'weld', label: 'Weld cert' },
  { value: 'mill', label: 'Mill cert' },
  { value: 'coating', label: 'Coating cert' },
  { value: 'itp', label: 'ITP' },
  { value: 'other', label: 'Other' },
]
const certLabel = (k: CertKind) => CERT_KINDS.find(c => c.value === k)?.label ?? k

const dm = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit' }) : '—'
const dmt = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString('en-AU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

export default function SubPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const [mode, setMode] = useState<Mode>('loading')
  const [pin, setPin] = useState('')
  const [proposedPin, setProposedPin] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState('')
  const [contractorName, setContractorName] = useState('')
  const [packages, setPackages] = useState<Pkg[]>([])
  const [loadError, setLoadError] = useState('')

  const signOut = useCallback(() => {
    localStorage.removeItem(STORE_KEY)
    setToken(''); setPackages([]); setPin(''); setProposedPin(null)
    setNotice(''); setError(''); setLoadError(''); setMode('login')
  }, [])

  const loadWork = useCallback(async (tok: string) => {
    try {
      const res = await fetch('/api/fab/sub/my-work', { headers: { Authorization: `Bearer ${tok}` } })
      if (res.status === 401) { signOut(); return }
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setLoadError('Could not load your work — check your signal and try again'); setMode('work'); return }
      setContractorName(j.contractor_name ?? '')
      setPackages(j.packages ?? [])
      setLoadError('')
      setMode('work')
    } catch {
      setLoadError('No connection — check your signal and try again')
      setMode('work')
    }
  }, [signOut])

  useEffect(() => {
    let stale = false
    const boot = async () => {
      let stored: { token: string; contractor_name?: string } | null = null
      try {
        const s = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as { token?: string; contractor_name?: string; slug?: string } | null
        if (s?.token && s.slug === slug) stored = { token: s.token, contractor_name: s.contractor_name }
      } catch { /* bad stored value — treat as signed out */ }
      await Promise.resolve() // yield a tick so state updates land outside the sync effect body
      if (stale) return
      if (!stored) { setMode('login'); return }
      setToken(stored.token)
      setContractorName(stored.contractor_name ?? '')
      loadWork(stored.token)
    }
    boot()
    return () => { stale = true }
  }, [slug, loadWork])

  function finishSignIn(j: { token: string; contractor_name?: string }) {
    localStorage.setItem(STORE_KEY, JSON.stringify({ token: j.token, contractor_name: j.contractor_name ?? '', slug }))
    setToken(j.token); setContractorName(j.contractor_name ?? '')
    setPin(''); setProposedPin(null); setNotice(''); setError('')
    setMode('loading')
    loadWork(j.token)
  }

  async function submitPin(value: string) {
    setBusy(true); setError('')
    try {
      if (mode === 'setup') {
        if (proposedPin === null) {
          setProposedPin(value); setPin('')
          setNotice('Now type it once more to confirm')
          return
        }
        if (value !== proposedPin) {
          setProposedPin(null); setPin('')
          setNotice('Those two did not match — no worries. Choose your PIN again.')
          return
        }
        const res = await fetch('/api/fab/sub/setup', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, pin: value }),
        })
        const j = await res.json().catch(() => ({}))
        if (res.status === 409) {
          setError(j.error ?? 'PIN already set — sign in with your PIN')
          setProposedPin(null); setPin(''); setNotice(''); setMode('login')
          return
        }
        if (!res.ok) {
          setError(j.error ?? 'Could not set your PIN — try again')
          setProposedPin(null); setPin('')
          return
        }
        finishSignIn(j)
        return
      }
      // login
      const res = await fetch('/api/fab/sub/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, pin: value }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.status === 409 && j.needs_setup) {
        setContractorName(j.contractor_name ?? '')
        setProposedPin(value); setPin('')
        setNotice('First time here — that will be your PIN. Type it once more to confirm.')
        setMode('setup')
        return
      }
      if (!res.ok) { setError(j.error ?? 'PIN not recognised — try again'); setPin(''); return }
      finishSignIn(j)
    } catch {
      setError('No connection — check your signal and try again')
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  function onDigit(d: string) {
    setError('')
    const next = pin.length < 4 ? pin + d : pin
    setPin(next)
    if (next.length === 4) submitPin(next)
  }

  const reload = () => { if (token) loadWork(token) }

  if (mode === 'loading') {
    return <main style={shell}><p style={{ textAlign: 'center', paddingTop: 80, color: 'var(--text-2)' }}>Loading…</p></main>
  }

  if (mode === 'login' || mode === 'setup') {
    return (
      <main style={{ ...shell, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <h1 style={{ color: 'var(--foreground)', fontWeight: 700, marginBottom: 8 }}>HYTEK Fab</h1>
        {contractorName && <p style={{ color: 'var(--text-2)', margin: '0 0 4px' }}>{contractorName}</p>}
        <p style={{ opacity: 0.7, marginBottom: 24, textAlign: 'center', maxWidth: 280 }}>
          {mode === 'setup'
            ? (proposedPin === null ? 'Set a 4-digit PIN so we know it is you' : 'Type your PIN again to confirm')
            : 'Enter your PIN'}
        </p>
        {notice && <p style={{ color: 'var(--info)', marginBottom: 16, textAlign: 'center', maxWidth: 280 }}>{notice}</p>}
        <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={{
              width: 24, height: 24, borderRadius: '50%',
              background: i < pin.length ? YELLOW : 'transparent',
              border: `2px solid ${YELLOW}`,
            }} />
          ))}
        </div>
        {error && <p style={{ color: 'var(--danger)', marginBottom: 16, textAlign: 'center', maxWidth: 280 }}>{error}</p>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 80px)', gap: 12 }}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
            <button key={d} disabled={busy} onClick={() => onDigit(d)} style={keyStyle}>{d}</button>
          ))}
          <button onClick={() => { setPin(''); setError('') }} style={{ ...keyStyle, fontSize: 16 }}>Clear</button>
          <button disabled={busy} onClick={() => onDigit('0')} style={keyStyle}>0</button>
          <span />
        </div>
      </main>
    )
  }

  // ── work view ──────────────────────────────────────────────────────────────
  return (
    <main style={shell}>
      <header style={{
        background: YELLOW, color: 'var(--on-brand)', padding: '14px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <a href={`/sub/${slug}`} aria-label="Home" style={{ color: 'inherit', textDecoration: 'none' }}>
            <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: 0.5 }}>HYTEK FAB</span>
          </a>
          {packages.map(p => p.job.quote_number && (
            <span key={p.package_id} style={quoteChip}>{p.job.quote_number}</span>
          ))}
        </div>
        <button onClick={signOut} style={signOutBtn}>Sign out</button>
      </header>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: 16 }}>
        {contractorName && <p style={{ color: 'var(--text-2)', margin: '0 0 16px', fontSize: 14 }}>Hi {contractorName}</p>}

        {loadError && (
          <div className="rounded-xl p-3 mb-3" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
            <p style={{ color: 'var(--danger)', margin: '0 0 8px', fontSize: 14 }}>{loadError}</p>
            <button onClick={reload} style={{ ...smallBtn, background: YELLOW, color: 'var(--on-brand)', border: 'none' }}>Try again</button>
          </div>
        )}

        {!loadError && packages.length === 0 && (
          <p style={{ color: 'var(--text-2)', textAlign: 'center', paddingTop: 40 }}>Nothing released to you yet — HYTEK will let you know.</p>
        )}

        {packages.map(pkg => (
          <PackageSection key={pkg.package_id} pkg={pkg} token={token} onDone={reload} />
        ))}
      </div>
    </main>
  )
}

// ── one package = one granted parcel of work ──────────────────────────────────
function PackageSection({ pkg, token, onDone }: { pkg: Pkg; token: string; onDone: () => void }) {
  const due = pkg.expected_return_date ?? pkg.job.on_site_date
  const pct = pkg.total_pieces > 0 ? Math.min(100, (pkg.made_count / pkg.total_pieces) * 100) : 0

  async function openDrawing(pieceId: string) {
    try {
      const res = await fetch(`/api/fab/sub/marks/${pieceId}/drawing`, { headers: { Authorization: `Bearer ${token}` } })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.url) window.open(j.url, '_blank', 'noopener')
      else alert('No drawing loaded for this job yet')
    } catch {
      alert('No connection — could not open the drawing')
    }
  }

  return (
    <section style={{ marginBottom: 32 }}>
      {/* header card */}
      <div className="rounded-xl p-4 mb-3" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
        <div style={{ fontWeight: 700, fontSize: 20, color: 'var(--foreground)' }}>
          {pkg.total_pieces} pieces released to you
        </div>
        {pkg.job.name && <div style={{ color: 'var(--text-2)', fontSize: 15, marginTop: 2 }}>{pkg.job.name}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {due && <span style={{ color: 'var(--foreground)', fontSize: 14, fontWeight: 600 }}>due {dm(due)}</span>}
          <span style={modeChip}>
            {pkg.delivery_mode === 'drop_ship' ? '🚚 straight to site' : '🏭 returns to HYTEK Brisbane'}
          </span>
          {pkg.treatment_type && <span style={modeChip}>{pkg.treatment_type}</span>}
        </div>
        {pkg.scope_note && <p style={{ color: 'var(--text-3)', fontSize: 13, margin: '8px 0 0' }}>{pkg.scope_note}</p>}

        {/* progress bar */}
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-2)', marginBottom: 4 }}>
            <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>{pkg.made_count} of {pkg.total_pieces} made</span>
            <span>{Math.round(pct)}%</span>
          </div>
          <div style={{ height: 10, borderRadius: 999, background: 'var(--track)' }}>
            <div style={{ height: '100%', borderRadius: 999, background: 'var(--success)', width: `${pct}%` }} />
          </div>
        </div>
      </div>

      {/* pieces */}
      <h2 style={sectionHead}>Pieces</h2>
      {pkg.pieces.map(p => (
        <div key={p.id} onClick={() => openDrawing(p.id)} style={pieceRow}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--foreground)' }}>
              {p.mark_id}
              <span style={qtyChip}>×{p.quantity}</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
              {[p.section, p.length_mm != null ? `${p.length_mm} mm` : null].filter(Boolean).join(' · ') || p.description || 'tap for drawing'}
            </div>
          </div>
          <div onClick={e => e.stopPropagation()} style={{ flexShrink: 0 }}>
            {p.made ? (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600,
                color: 'var(--success)', background: 'rgba(21,128,61,.08)', border: '1px solid rgba(21,128,61,.35)',
                borderRadius: 999, padding: '8px 12px',
              }}>✓ {dmt(p.made_at)}</span>
            ) : (
              <SubPhotoButton token={token} packageId={pkg.package_id} stage="made" markId={p.id} label="Made" onDone={onDone} />
            )}
          </div>
        </div>
      ))}

      {/* whole load */}
      <h2 style={sectionHead}>Whole load</h2>
      <div className="rounded-xl p-3 mb-3" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <SubPhotoButton token={token} packageId={pkg.package_id} stage="treatment_out" treatmentType={pkg.treatment_type ?? undefined} label="Away to coating" count={pkg.stage_counts.treatment_out} big onDone={onDone} />
          <SubPhotoButton token={token} packageId={pkg.package_id} stage="treatment_in" treatmentType={pkg.treatment_type ?? undefined} label="Back from coating" count={pkg.stage_counts.treatment_in} big onDone={onDone} />
          <SubPhotoButton token={token} packageId={pkg.package_id} stage="bundled" label="Bundled" count={pkg.stage_counts.bundled} big onDone={onDone} />
          <SubPhotoButton token={token} packageId={pkg.package_id} stage="loaded" label="Loaded on truck" count={pkg.stage_counts.loaded} big onDone={onDone} />
        </div>
      </div>

      <CertsSection pkg={pkg} token={token} onDone={onDone} />
      <ProgressSection pkg={pkg} token={token} onDone={onDone} />
      <ReadySection pkg={pkg} token={token} onDone={onDone} />
    </section>
  )
}

// ── camera button posting to the sub proof endpoint ───────────────────────────
function SubPhotoButton({ token, packageId, stage, markId, treatmentType, label, count, big, onDone }: {
  token: string; packageId: string; stage: Stage
  markId?: string; treatmentType?: string
  label: string; count?: number; big?: boolean; onDone: () => void
}) {
  const [busy, setBusy] = useState(false)

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('stage', stage)
      fd.append('fab_package_id', packageId)
      if (markId) fd.append('fab_mark_id', markId)
      if (treatmentType) fd.append('treatment_type', treatmentType)
      const res = await fetch('/api/fab/sub/proof', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(j.error ?? 'The photo did not send — try again')
        return
      }
      onDone()
    } catch {
      alert('No connection — the photo did not send. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <label style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      cursor: busy ? 'default' : 'pointer', textAlign: 'center',
      fontSize: big ? 15 : 14, fontWeight: 700,
      color: 'var(--on-brand)', background: YELLOW,
      border: 'none', borderRadius: 12,
      padding: big ? '16px 12px' : '12px 16px',
      minHeight: big ? 56 : 44,
      opacity: busy ? 0.5 : 1,
    }}>
      {busy ? 'Uploading…' : `📷 ${label}`}
      {!busy && count != null && count > 0 && (
        <span style={{
          background: 'var(--on-brand)', color: YELLOW, borderRadius: 999,
          fontSize: 12, fontWeight: 700, padding: '1px 8px',
        }}>{count}</span>
      )}
      <input type="file" accept="image/*" capture="environment" disabled={busy} onChange={onPick} style={{ display: 'none' }} />
    </label>
  )
}

// ── certs ─────────────────────────────────────────────────────────────────────
function CertsSection({ pkg, token, onDone }: { pkg: Pkg; token: string; onDone: () => void }) {
  const [kind, setKind] = useState<CertKind>('qa')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('kind', kind)
      fd.append('fab_package_id', pkg.package_id)
      if (note.trim()) fd.append('note', note.trim())
      const res = await fetch('/api/fab/sub/certs', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(j.error ?? 'The cert did not send — try again')
        return
      }
      setNote('')
      onDone()
    } catch {
      alert('No connection — the cert did not send. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h2 style={sectionHead}>Certs</h2>
      <div className="rounded-xl p-3 mb-3" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
        {pkg.delivery_mode === 'drop_ship' && (
          <p style={{
            color: 'var(--warning)', fontSize: 13, fontWeight: 600, margin: '0 0 10px',
            border: '1px solid var(--warning)', borderRadius: 8, padding: '8px 10px',
          }}>
            This load goes straight to site — certs are required before pickup.
          </p>
        )}

        {pkg.certs.length === 0 && <p style={{ color: 'var(--text-3)', fontSize: 13, margin: '0 0 10px' }}>— no certs attached yet</p>}
        {pkg.certs.map(c => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13, marginBottom: 6 }}>
            <span style={{ fontWeight: 600, color: 'var(--foreground)', flexShrink: 0 }}>{certLabel(c.kind)}</span>
            <span style={{ color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.file_name}</span>
            <span style={{ color: 'var(--text-3)', marginLeft: 'auto', flexShrink: 0 }}>{dm(c.uploaded_at)}</span>
          </div>
        ))}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          <select value={kind} onChange={e => setKind(e.target.value as CertKind)} disabled={busy} style={inputStyle}>
            {CERT_KINDS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <input value={note} onChange={e => setNote(e.target.value)} disabled={busy} placeholder="Note (optional)" style={inputStyle} />
          <label style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            cursor: busy ? 'default' : 'pointer',
            fontSize: 15, fontWeight: 700, color: 'var(--on-brand)', background: YELLOW,
            borderRadius: 12, padding: '14px 16px', opacity: busy ? 0.5 : 1,
          }}>
            {busy ? 'Uploading…' : '📄 Attach cert'}
            <input type="file" accept="image/*,application/pdf" disabled={busy} onChange={onPick} style={{ display: 'none' }} />
          </label>
        </div>
      </div>
    </>
  )
}

// ── progress report ───────────────────────────────────────────────────────────
function ProgressSection({ pkg, token, onDone }: { pkg: Pkg; token: string; onDone: () => void }) {
  const [pct, setPct] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function send() {
    if (!note.trim()) { alert('Add a quick note first — even one word helps'); return }
    setBusy(true)
    try {
      const body: { note: string; reported_pct?: number } = { note: note.trim() }
      const n = parseInt(pct, 10)
      if (!Number.isNaN(n)) body.reported_pct = Math.max(0, Math.min(100, n))
      const res = await fetch(`/api/fab/sub/packages/${pkg.package_id}/progress`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(j.error ?? 'The update did not send — try again')
        return
      }
      setNote(''); setPct('')
      onDone()
    } catch {
      alert('No connection — the update did not send. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h2 style={sectionHead}>Progress</h2>
      <div className="rounded-xl p-3 mb-3" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={pct} onChange={e => setPct(e.target.value.replace(/\D/g, '').slice(0, 3))}
            disabled={busy} placeholder="%" inputMode="numeric" style={{ ...inputStyle, width: 72, flexShrink: 0, textAlign: 'center' }} />
          <input value={note} onChange={e => setNote(e.target.value)} disabled={busy}
            placeholder="How is it going?" style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
        </div>
        <button onClick={send} disabled={busy} style={{
          ...smallBtn, width: '100%', marginTop: 8, background: YELLOW, color: 'var(--on-brand)',
          border: 'none', fontWeight: 700, fontSize: 15, padding: '12px 16px', opacity: busy ? 0.5 : 1,
        }}>
          {busy ? 'Sending…' : 'Send update'}
        </button>

        {pkg.recent_updates.length > 0 && (
          <div style={{ marginTop: 12, borderTop: '0.5px solid var(--border)', paddingTop: 10 }}>
            {pkg.recent_updates.slice(0, 3).map((u, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, marginBottom: 6 }}>
                <span style={{ color: 'var(--text-3)', flexShrink: 0 }}>{dm(u.logged_at)}</span>
                <span style={{ color: 'var(--text-2)' }}>
                  {u.reported_pct != null && <strong style={{ color: 'var(--foreground)' }}>{u.reported_pct}% — </strong>}
                  {u.note}
                  {u.eta && <span style={{ color: 'var(--text-3)' }}> · eta {dm(u.eta)}</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// ── ready to collect ──────────────────────────────────────────────────────────
function ReadySection({ pkg, token, onDone }: { pkg: Pkg; token: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [blockers, setBlockers] = useState<string[]>([])
  const [readyAt, setReadyAt] = useState<string | null>(null)

  const doneAt = pkg.ready_at ?? readyAt

  async function markReady() {
    setBusy(true); setBlockers([])
    try {
      const res = await fetch(`/api/fab/sub/packages/${pkg.package_id}/ready`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      })
      const j = await res.json().catch(() => ({}))
      if (res.status === 409) { setBlockers(j.blockers ?? [j.error ?? 'Not ready yet']); return }
      if (!res.ok) { alert(j.error ?? 'That did not go through — try again'); return }
      setReadyAt(j.ready_at ?? new Date().toISOString())
      onDone()
    } catch {
      alert('No connection — that did not go through. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (doneAt) {
    return (
      <div className="rounded-xl p-4" style={{
        background: 'rgba(21,128,61,.08)', border: '1px solid rgba(21,128,61,.35)', textAlign: 'center',
      }}>
        <div style={{ color: 'var(--success)', fontWeight: 700, fontSize: 17 }}>✓ Marked ready — HYTEK has been told</div>
        <div style={{ color: 'var(--text-2)', fontSize: 13, marginTop: 4 }}>{dmt(doneAt)}</div>
      </div>
    )
  }

  return (
    <div>
      {blockers.length > 0 && (
        <div className="rounded-xl p-3 mb-3" style={{ background: 'var(--surface)', border: '1px solid var(--warning)' }}>
          <p style={{ color: 'var(--warning)', fontWeight: 700, fontSize: 14, margin: '0 0 6px' }}>Before you can mark ready:</p>
          <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--text-2)', fontSize: 14 }}>
            {blockers.map((b, i) => <li key={i} style={{ marginBottom: 2 }}>{b}</li>)}
          </ul>
        </div>
      )}
      <button onClick={markReady} disabled={busy} style={{
        width: '100%', background: YELLOW, color: 'var(--on-brand)', border: 'none',
        borderRadius: 12, padding: '18px 16px', fontSize: 17, fontWeight: 800,
        cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1,
      }}>
        {busy ? 'Sending…' : '🚚 Ready to collect'}
      </button>
    </div>
  )
}

// ── styles ────────────────────────────────────────────────────────────────────
const shell: React.CSSProperties = { minHeight: '100vh', background: 'var(--background)', color: 'var(--foreground)', fontFamily: 'system-ui, sans-serif' }
const keyStyle: React.CSSProperties = {
  width: 80, height: 80, fontSize: 28, borderRadius: 12,
  border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', cursor: 'pointer',
}
const sectionHead: React.CSSProperties = { color: 'var(--foreground)', fontWeight: 700, fontSize: 16, margin: '0 0 10px' }
const pieceRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, borderRadius: 12, padding: 14, marginBottom: 10,
  background: 'var(--surface)', border: '0.5px solid var(--border)', cursor: 'pointer',
}
const quoteChip: React.CSSProperties = {
  background: 'var(--on-brand)', color: YELLOW, borderRadius: 999,
  fontSize: 12, fontWeight: 700, padding: '3px 10px',
}
const modeChip: React.CSSProperties = {
  background: 'var(--chip-brand-bg)', color: 'var(--foreground)', borderRadius: 999,
  fontSize: 12, fontWeight: 600, padding: '3px 10px',
}
const qtyChip: React.CSSProperties = {
  background: 'var(--surface-2)', color: 'var(--text-2)', borderRadius: 999,
  fontSize: 12, fontWeight: 600, padding: '2px 8px', marginLeft: 8, verticalAlign: 'middle',
}
const signOutBtn: React.CSSProperties = {
  background: 'transparent', color: 'var(--on-brand)', border: '1px solid var(--on-brand)',
  borderRadius: 10, padding: '6px 12px', cursor: 'pointer', fontSize: 13, flexShrink: 0,
}
const smallBtn: React.CSSProperties = {
  borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontSize: 14,
  background: 'var(--surface)', color: 'var(--foreground)', border: '1px solid var(--border)',
}
const inputStyle: React.CSSProperties = {
  background: 'var(--surface-2)', color: 'var(--foreground)', border: '0.5px solid var(--border)',
  borderRadius: 10, padding: '12px 12px', fontSize: 15,
}
