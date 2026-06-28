'use client'

// PIN roster management (PC). Add / change PIN / deactivate floor workers.
// Floor crew sign in on the tablet at /kiosk with their PIN.
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { AppShell } from '@/components/app-shell'
import { supabase } from '@/lib/supabase'

interface Worker { id: string; worker_name: string; role: string; is_active: boolean }

export default function AdminWorkersPage() {
  const { user, profile, loading } = useAuth()
  const router = useRouter()
  const [workers, setWorkers] = useState<Worker[]>([])
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [role, setRole] = useState('fabricator')
  const [msg, setMsg] = useState('')

  const authHeader = useCallback(async (json = false): Promise<Record<string, string>> => {
    const { data } = await supabase.auth.getSession()
    const h: Record<string, string> = { Authorization: `Bearer ${data.session?.access_token ?? ''}` }
    if (json) h['Content-Type'] = 'application/json'
    return h
  }, [])

  const load = useCallback(async () => {
    const res = await fetch('/api/fab/pin/workers', { headers: await authHeader() })
    if (res.ok) setWorkers((await res.json()).workers ?? [])
  }, [authHeader])

  useEffect(() => { if (!loading && !user) router.push('/login') }, [user, loading, router])
  useEffect(() => { if (user) load() }, [user, load])

  async function addWorker(e: React.FormEvent) {
    e.preventDefault(); setMsg('')
    if (!name.trim()) { setMsg('❌ Enter a name'); return }
    if (!/^\d{4}$/.test(pin)) { setMsg('❌ PIN must be 4 digits'); return }
    const res = await fetch('/api/fab/pin/workers', {
      method: 'POST', headers: await authHeader(true),
      body: JSON.stringify({ worker_name: name.trim(), pin, role }),
    })
    const json = await res.json()
    if (!res.ok) { setMsg('❌ ' + (json.error ?? 'Failed')); return }
    setName(''); setPin(''); setRole('fabricator'); setMsg(`✓ Added ${json.worker.worker_name}`)
    load()
  }

  async function changePin(id: string) {
    const newPin = prompt('New 4-digit PIN')
    if (!newPin) return
    const res = await fetch(`/api/fab/pin/workers/${id}`, {
      method: 'PATCH', headers: await authHeader(true), body: JSON.stringify({ pin: newPin }),
    })
    setMsg(res.ok ? '✓ PIN updated' : '❌ ' + ((await res.json()).error ?? 'Failed'))
  }

  async function deactivate(id: string) {
    await fetch(`/api/fab/pin/workers/${id}`, { method: 'DELETE', headers: await authHeader() })
    load()
  }

  if (loading || !user) return null
  const canManage = profile?.role === 'admin' || profile?.role === 'supervisor'

  return (
    <AppShell>
      <div className="p-4 max-w-2xl mx-auto">
        <h1 className="text-lg font-semibold mb-1" style={{ color: '#FFCB05' }}>Workers — PIN roster</h1>
        <p className="text-xs mb-4" style={{ color: '#666' }}>
          Floor crew sign in on the tablet at <strong>/kiosk</strong> with their PIN. A supervisor PIN opens the QC + packages panel; a fabricator PIN opens their work list.
        </p>

        {!canManage && <p className="text-sm" style={{ color: '#ff6b6b' }}>Admin or supervisor only.</p>}

        {canManage && (
          <form onSubmit={addWorker} className="rounded-xl p-3 mb-4" style={{ background: '#232326', border: '0.5px solid #2a2a2a' }}>
            <p className="text-xs mb-2" style={{ color: '#555' }}>Add worker</p>
            <div className="flex gap-2 flex-wrap items-center">
              <input placeholder="Name" value={name} onChange={e => setName(e.target.value)} style={inp} />
              <input placeholder="4-digit PIN" value={pin} onChange={e => setPin(e.target.value)} maxLength={4} inputMode="numeric" style={{ ...inp, width: 130 }} />
              <select value={role} onChange={e => setRole(e.target.value)} style={inp}>
                <option value="fabricator">Fabricator</option>
                <option value="supervisor">Supervisor</option>
                <option value="admin">Admin</option>
              </select>
              <button type="submit" className="rounded-lg text-sm font-medium" style={{ background: '#FFCB05', color: '#231F20', border: 'none', padding: '8px 16px', cursor: 'pointer' }}>Add</button>
            </div>
            {msg && <p className="text-xs mt-2" style={{ color: msg.startsWith('❌') ? '#ff6b6b' : '#97C459' }}>{msg}</p>}
          </form>
        )}

        <div className="flex flex-col gap-1">
          {workers.filter(w => w.is_active).length === 0 && <p className="text-sm" style={{ color: '#555' }}>No workers yet.</p>}
          {workers.filter(w => w.is_active).map(w => (
            <div key={w.id} className="rounded-lg p-2 flex items-center gap-2" style={{ background: '#232326', border: '0.5px solid #2a2a2a' }}>
              <span className="text-sm flex-1" style={{ color: '#fff' }}>{w.worker_name} <span style={{ color: '#777' }}>· {w.role}</span></span>
              {canManage && (
                <>
                  <button onClick={() => changePin(w.id)} className="text-xs px-2 py-1 rounded" style={{ background: 'transparent', border: '0.5px solid #555', color: '#aaa', cursor: 'pointer' }}>Change PIN</button>
                  <button onClick={() => deactivate(w.id)} className="text-xs px-2 py-1 rounded" style={{ background: 'transparent', border: '0.5px solid #555', color: '#aaa', cursor: 'pointer' }}>Remove</button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  )
}

const inp: React.CSSProperties = { background: '#1a1a1c', color: '#fff', border: '1px solid #2a2a2a', borderRadius: 8, padding: '8px 10px', fontSize: 14 }
