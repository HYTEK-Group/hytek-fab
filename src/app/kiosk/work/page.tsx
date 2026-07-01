'use client'

// Worker view: MY assemblies to make, across jobs. Tap Start when you pick it up,
// Done when it's finished — the app captures the real time (which sharpens the
// suggestions) and shows the drawing for each piece. Auto-signs-out after 30 min idle.
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

const IDLE_MS = 30 * 60 * 1000

interface Session { worker_name: string; role: string; token: string; signed_in_at: number }
interface WorkItem {
  id: string; mark_id: string; description: string | null; section: string | null
  weight_kg: number | null; quantity: number; status: string
  allotted_minutes: number | null; actual_minutes: number | null
  quote_number: string | null; job_name: string | null
}
interface Summary { total: number; done: number; tonnes_total: number; tonnes_done: number }

const tonnesOf = (m: WorkItem) => Math.round((Math.max(0, m.weight_kg ?? 0) * (m.quantity ?? 1)) / 10) / 100
const hrs = (min: number | null | undefined) => (min == null ? '—' : `${Math.round((min / 60) * 10) / 10} h`)
const isDone = (s: string) => s === 'done' || s === 'qc_passed'

export default function KioskWorkPage() {
  const router = useRouter()
  const [session, setSession] = useState<Session | null>(null)
  const [items, setItems] = useState<WorkItem[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)

  const signOut = useCallback(() => { sessionStorage.removeItem('fab_kiosk'); router.push('/kiosk') }, [router])

  const load = useCallback(async (token: string) => {
    setLoading(true)
    const res = await fetch('/api/fab/my-work', { headers: { authorization: `Bearer ${token}` } })
    if (res.status === 401) { signOut(); return }
    const json = await res.json()
    setItems(json.items ?? [])
    setSummary(json.summary ?? null)
    setLoading(false)
  }, [signOut])

  useEffect(() => {
    const raw = sessionStorage.getItem('fab_kiosk')
    if (!raw) { router.push('/kiosk'); return }
    const s = JSON.parse(raw) as Session
    setSession(s); load(s.token)
  }, [router, load])

  useEffect(() => {
    let timer = setTimeout(signOut, IDLE_MS)
    const reset = () => { clearTimeout(timer); timer = setTimeout(signOut, IDLE_MS) }
    window.addEventListener('click', reset); window.addEventListener('touchstart', reset)
    return () => { clearTimeout(timer); window.removeEventListener('click', reset); window.removeEventListener('touchstart', reset) }
  }, [signOut])

  async function work(id: string, action: 'start' | 'done') {
    if (!session) return
    const res = await fetch(`/api/fab/marks/${id}/work`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ action }),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) { alert(j.error ?? 'Failed'); return }
    setItems(prev => prev.map(m => m.id === id
      ? { ...m, status: action === 'start' ? 'in_progress' : 'done', actual_minutes: action === 'done' ? (j.actual_minutes ?? m.actual_minutes) : m.actual_minutes }
      : m))
  }

  async function openDrawing(id: string) {
    if (!session) return
    const res = await fetch(`/api/fab/marks/${id}/drawing`, { headers: { authorization: `Bearer ${session.token}` } })
    const j = await res.json().catch(() => ({}))
    if (res.ok && j.url) window.open(j.url, '_blank', 'noopener')
    else alert(j.error ?? 'No drawing found yet')
  }

  if (loading) return <main style={shell}><p>Loading…</p></main>

  const groups = new Map<string, WorkItem[]>()
  for (const m of items) { const k = m.quote_number ?? '—'; const a = groups.get(k) ?? []; a.push(m); groups.set(k, a) }

  return (
    <main style={shell}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h1 style={{ color: 'var(--foreground)', fontWeight: 700, margin: 0, fontSize: 22 }}>Hi {session?.worker_name}</h1>
        <button onClick={signOut} style={signOutBtn}>Sign out</button>
      </header>
      {summary && (
        <p style={{ color: 'var(--text-2)', margin: '0 0 20px', fontSize: 15 }}>
          {summary.done} of {summary.total} done · {summary.tonnes_done} / {summary.tonnes_total} t
        </p>
      )}

      {items.length === 0 && <p style={{ color: 'var(--text-2)' }}>Nothing assigned to you yet.</p>}

      {Array.from(groups.entries()).map(([quote, list]) => (
        <section key={quote} style={{ marginBottom: 28 }}>
          <h2 style={sectionHead}>{list[0].job_name ?? quote}</h2>
          {list.map(m => {
            const done = isDone(m.status)
            const running = m.status === 'in_progress'
            return (
              <div key={m.id} style={{ ...card, border: done ? '1px solid rgba(21,128,61,.35)' : '0.5px solid var(--border)', background: done ? 'rgba(21,128,61,.08)' : 'var(--surface)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: 'var(--foreground)', fontSize: 16 }}>{m.mark_id} · {m.section ?? '—'}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
                    {tonnesOf(m)} t · allotted {hrs(m.allotted_minutes)}
                    {done && <span style={{ color: 'var(--success)' }}> · done in {hrs(m.actual_minutes)}</span>}
                    {' · '}
                    <button onClick={() => openDrawing(m.id)} style={drawLink}>drawing</button>
                  </div>
                </div>
                {done ? (
                  <span style={{ color: 'var(--success)', fontSize: 26, fontWeight: 700 }}>✓</span>
                ) : running ? (
                  <button onClick={() => work(m.id, 'done')} style={{ ...bigBtn, background: 'var(--success)', color: '#fff' }}>Done</button>
                ) : (
                  <button onClick={() => work(m.id, 'start')} style={bigBtn}>Start</button>
                )}
              </div>
            )
          })}
        </section>
      ))}
    </main>
  )
}

const shell: React.CSSProperties = { minHeight: '100vh', background: 'var(--background)', color: 'var(--foreground)', padding: 24, fontFamily: 'system-ui, sans-serif' }
const sectionHead: React.CSSProperties = { color: 'var(--foreground)', fontWeight: 700, fontSize: 17, marginBottom: 12 }
const card: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, borderRadius: 12, padding: 16, marginBottom: 12 }
const bigBtn: React.CSSProperties = { background: 'var(--hytek-yellow)', color: 'var(--on-brand)', border: 'none', borderRadius: 10, padding: '12px 26px', fontSize: 16, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }
const drawLink: React.CSSProperties = { background: 'transparent', border: 'none', color: 'var(--info)', fontSize: 13, cursor: 'pointer', padding: 0, textDecoration: 'underline' }
const signOutBtn: React.CSSProperties = { background: 'transparent', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 16px', cursor: 'pointer' }
