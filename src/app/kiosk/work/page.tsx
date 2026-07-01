'use client'

// Worker view: this worker's tasks + in-house marks. One tap = done.
// Auto-signs-out after 30 min idle. Kiosk token from sessionStorage.
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

const IDLE_MS = 30 * 60 * 1000

interface Session { worker_name: string; role: string; token: string; signed_in_at: number }
interface JobRef { id?: string; name: string; quote_number: string }
interface TaskItem { id: string; fab_job_id: string; description: string; status: string; fab_jobs: JobRef | JobRef[] }
interface MarkItem { id: string; fab_job_id: string; mark_id: string; description: string | null; status: string; fab_jobs: JobRef | JobRef[] }

function jobName(j: JobRef | JobRef[]): string {
  const r = Array.isArray(j) ? j[0] : j
  return r ? `${r.quote_number} — ${r.name}` : ''
}

export default function KioskWorkPage() {
  const router = useRouter()
  const [session, setSession] = useState<Session | null>(null)
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [marks, setMarks] = useState<MarkItem[]>([])
  const [loading, setLoading] = useState(true)

  const signOut = useCallback(() => {
    sessionStorage.removeItem('fab_kiosk')
    router.push('/kiosk')
  }, [router])

  const load = useCallback(async (token: string) => {
    setLoading(true)
    const res = await fetch('/api/fab/kiosk/my-work', {
      headers: { authorization: `Bearer ${token}` },
    })
    if (res.status === 401) { signOut(); return }
    const json = await res.json()
    setTasks(json.tasks ?? [])
    setMarks(json.marks ?? [])
    setLoading(false)
  }, [signOut])

  useEffect(() => {
    const raw = sessionStorage.getItem('fab_kiosk')
    if (!raw) { router.push('/kiosk'); return }
    const s = JSON.parse(raw) as Session
    setSession(s)
    load(s.token)
  }, [router, load])

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

  async function markTaskDone(id: string, jobId: string) {
    if (!session) return
    await fetch(`/api/fab/jobs/${jobId}/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ status: 'done' }),
    })
    setTasks(tasks.filter(t => t.id !== id))
  }

  async function markMarkDone(id: string, jobId: string) {
    if (!session) return
    await fetch(`/api/fab/jobs/${jobId}/marks`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ mark_ids: [id], status: 'done' }),
    })
    setMarks(marks.filter(m => m.id !== id))
  }

  if (loading) return <main style={shell}><p>Loading…</p></main>

  return (
    <main style={shell}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ color: 'var(--foreground)', fontWeight: 700, margin: 0 }}>Hi {session?.worker_name}</h1>
        <button onClick={signOut} style={signOutBtn}>Sign out</button>
      </header>

      <section style={{ marginBottom: 32 }}>
        <h2 style={sectionHead}>My tasks ({tasks.length})</h2>
        {tasks.length === 0 && <p style={{ opacity: 0.6 }}>No tasks assigned.</p>}
        {tasks.map(t => (
          <div key={t.id} style={card}>
            <div>
              <div style={{ fontWeight: 600 }}>{t.description}</div>
              <div style={{ fontSize: 13, opacity: 0.6 }}>{jobName(t.fab_jobs)}</div>
            </div>
            <button onClick={() => markTaskDone(t.id, t.fab_job_id)} style={doneBtn}>Done</button>
          </div>
        ))}
      </section>

      <section>
        <h2 style={sectionHead}>My marks ({marks.length})</h2>
        {marks.length === 0 && <p style={{ opacity: 0.6 }}>No marks assigned.</p>}
        {marks.map(m => (
          <div key={m.id} style={card}>
            <div>
              <div style={{ fontWeight: 600 }}>{m.mark_id}{m.description ? ` — ${m.description}` : ''}</div>
              <div style={{ fontSize: 13, opacity: 0.6 }}>{jobName(m.fab_jobs)}</div>
            </div>
            <button onClick={() => markMarkDone(m.id, m.fab_job_id)} style={doneBtn}>Done</button>
          </div>
        ))}
      </section>
    </main>
  )
}

const shell: React.CSSProperties = {
  minHeight: '100vh', background: 'var(--background)', color: 'var(--foreground)', padding: 24,
  fontFamily: 'system-ui, sans-serif',
}
const sectionHead: React.CSSProperties = { color: 'var(--foreground)', fontWeight: 700, fontSize: 18, marginBottom: 12 }
const card: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  background: 'var(--surface)', borderRadius: 12, padding: 16, marginBottom: 12,
}
const doneBtn: React.CSSProperties = {
  background: 'var(--hytek-yellow)', color: 'var(--on-brand)', border: 'none', borderRadius: 10,
  padding: '12px 24px', fontSize: 16, fontWeight: 700, cursor: 'pointer',
}
const signOutBtn: React.CSSProperties = {
  background: 'transparent', color: 'var(--foreground)', border: '1px solid var(--border)',
  borderRadius: 10, padding: '8px 16px', cursor: 'pointer',
}
