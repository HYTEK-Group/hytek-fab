'use client'

// PIN roster management (PC, Supabase auth). Add / change PIN / deactivate.
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

const YELLOW = '#FFCB05'

interface Worker { id: string; worker_name: string; role: string; is_active: boolean }

export default function AdminWorkersPage() {
  const [workers, setWorkers] = useState<Worker[]>([])
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [role, setRole] = useState('fabricator')
  const [msg, setMsg] = useState('')

  const authHeader = useCallback(async (): Promise<Record<string, string>> => {
    const { data } = await supabase.auth.getSession()
    return { Authorization: `Bearer ${data.session?.access_token ?? ''}` }
  }, [])

  const load = useCallback(async () => {
    const headers = await authHeader()
    const res = await fetch('/api/fab/pin/workers', { headers })
    const json = await res.json()
    setWorkers(json.workers ?? [])
  }, [authHeader])

  useEffect(() => { load() }, [load])

  async function addWorker(e: React.FormEvent) {
    e.preventDefault()
    setMsg('')
    const headers = { 'Content-Type': 'application/json', ...(await authHeader()) }
    const res = await fetch('/api/fab/pin/workers', {
      method: 'POST', headers,
      body: JSON.stringify({ worker_name: name, pin, role }),
    })
    const json = await res.json()
    if (!res.ok) { setMsg(json.error ?? 'Failed'); return }
    setName(''); setPin(''); setRole('fabricator')
    load()
  }

  async function changePin(id: string) {
    const newPin = prompt('New 4-digit PIN')
    if (!newPin) return
    const headers = { 'Content-Type': 'application/json', ...(await authHeader()) }
    const res = await fetch(`/api/fab/pin/workers/${id}`, {
      method: 'PATCH', headers, body: JSON.stringify({ pin: newPin }),
    })
    if (!res.ok) { const j = await res.json(); setMsg(j.error ?? 'Failed'); return }
    setMsg('PIN updated')
  }

  async function deactivate(id: string) {
    const headers = await authHeader()
    await fetch(`/api/fab/pin/workers/${id}`, { method: 'DELETE', headers })
    load()
  }

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 720 }}>
      <h1 style={{ color: YELLOW }}>PIN roster</h1>
      <form onSubmit={addWorker} style={{ display: 'flex', gap: 8, margin: '16px 0', flexWrap: 'wrap' }}>
        <input placeholder="Worker name" value={name} onChange={e => setName(e.target.value)} required />
        <input placeholder="4-digit PIN" value={pin} onChange={e => setPin(e.target.value)}
          maxLength={4} pattern="\d{4}" required />
        <select value={role} onChange={e => setRole(e.target.value)}>
          <option value="fabricator">Fabricator</option>
          <option value="supervisor">Supervisor</option>
          <option value="admin">Admin</option>
        </select>
        <button type="submit">Add</button>
      </form>
      {msg && <p>{msg}</p>}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>Name</th><th style={th}>Role</th><th style={th}>Active</th><th style={th}></th></tr></thead>
        <tbody>
          {workers.map(w => (
            <tr key={w.id}>
              <td style={td}>{w.worker_name}</td>
              <td style={td}>{w.role}</td>
              <td style={td}>{w.is_active ? 'Yes' : 'No'}</td>
              <td style={td}>
                <button onClick={() => changePin(w.id)}>Change PIN</button>{' '}
                {w.is_active && <button onClick={() => deactivate(w.id)}>Deactivate</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}

const th: React.CSSProperties = { textAlign: 'left', borderBottom: '2px solid #ddd', padding: 8 }
const td: React.CSSProperties = { borderBottom: '1px solid #eee', padding: 8 }
