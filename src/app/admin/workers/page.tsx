'use client'

// PIN roster management (PC). Add / change PIN / deactivate floor workers.
// Floor crew sign in on the tablet at /kiosk with their PIN.
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { AppShell } from '@/components/app-shell'
import { supabase } from '@/lib/supabase'

interface Worker { id: string; worker_name: string; role: string; is_active: boolean; profile_id: string | null }
interface LoginProfile { id: string; full_name: string | null; role: string }

export default function AdminWorkersPage() {
  const { user, profile, loading } = useAuth()
  const router = useRouter()
  const [workers, setWorkers] = useState<Worker[]>([])
  const [profiles, setProfiles] = useState<LoginProfile[]>([])
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
    const [wr, pr] = await Promise.all([
      fetch('/api/fab/pin/workers', { headers: await authHeader() }),
      fetch('/api/fab/pin/profiles', { headers: await authHeader() }),
    ])
    if (wr.ok) setWorkers((await wr.json()).workers ?? [])
    if (pr.ok) setProfiles((await pr.json()).profiles ?? [])
  }, [authHeader])

  async function linkLogin(id: string, profile_id: string) {
    const res = await fetch(`/api/fab/pin/workers/${id}`, {
      method: 'PATCH', headers: await authHeader(true),
      body: JSON.stringify({ profile_id: profile_id || null }),
    })
    setMsg(res.ok ? '✓ Login link updated' : '❌ ' + ((await res.json()).error ?? 'Failed'))
    load()
  }

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
  const isAdmin = profile?.role === 'admin'

  return (
    <AppShell>
      <div className="p-4 max-w-2xl mx-auto">
        <h1 className="text-lg font-semibold mb-1" style={{ color: 'var(--foreground)', fontWeight: 700 }}>Workers — PIN roster</h1>
        <p className="text-xs mb-4" style={{ color: 'var(--text-2)' }}>
          Floor crew sign in on the tablet at <strong>/kiosk</strong> with their PIN. A supervisor PIN opens the QC + packages panel; a fabricator PIN opens their work list.
        </p>

        {!canManage && <p className="text-sm" style={{ color: 'var(--danger)' }}>Admin or supervisor only.</p>}

        {canManage && (
          <form onSubmit={addWorker} className="rounded-xl p-3 mb-4" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
            <p className="text-xs mb-2" style={{ color: 'var(--text-2)' }}>Add worker</p>
            <div className="flex gap-2 flex-wrap items-center">
              <input placeholder="Name" value={name} onChange={e => setName(e.target.value)} style={inp} />
              <input placeholder="4-digit PIN" value={pin} onChange={e => setPin(e.target.value)} maxLength={4} inputMode="numeric" style={{ ...inp, width: 130 }} />
              <select value={role} onChange={e => setRole(e.target.value)} style={inp}>
                <option value="fabricator">Fabricator</option>
                <option value="supervisor">Supervisor</option>
                <option value="admin">Admin</option>
              </select>
              <button type="submit" className="rounded-lg text-sm font-medium" style={{ background: 'var(--hytek-yellow)', color: 'var(--on-brand)', border: 'none', padding: '8px 16px', cursor: 'pointer' }}>Add</button>
            </div>
            {msg && <p className="text-xs mt-2" style={{ color: msg.startsWith('❌') ? 'var(--danger)' : 'var(--success)' }}>{msg}</p>}
          </form>
        )}

        <div className="flex flex-col gap-1">
          {workers.filter(w => w.is_active).length === 0 && <p className="text-sm" style={{ color: 'var(--text-2)' }}>No workers yet.</p>}
          {workers.filter(w => w.is_active).map(w => (
            <div key={w.id} className="rounded-lg p-2 flex items-center gap-2 flex-wrap" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
              <span className="text-sm flex-1" style={{ color: 'var(--foreground)', minWidth: 120 }}>{w.worker_name} <span style={{ color: 'var(--text-2)' }}>· {w.role}</span></span>
              {/* Link a PIN to its owner's login so the gatekeeper treats their
                  tablet + PC actions as one person (admins/supervisors who clear
                  exceptions). Admin-only. */}
              {isAdmin && (w.role === 'admin' || w.role === 'supervisor') && (
                <select value={w.profile_id ?? ''} onChange={e => linkLogin(w.id, e.target.value)} title="Linked login (for gatekeeper)"
                  style={{ ...inp, fontSize: 12, padding: '5px 8px', maxWidth: 190 }}>
                  <option value="">Login: not linked</option>
                  {profiles.map(p => <option key={p.id} value={p.id}>Login: {p.full_name}</option>)}
                </select>
              )}
              {canManage && (
                <>
                  <button onClick={() => changePin(w.id)} className="text-xs px-2 py-1 rounded" style={{ background: 'transparent', border: '0.5px solid var(--border)', color: 'var(--text-3)', cursor: 'pointer' }}>Change PIN</button>
                  <button onClick={() => deactivate(w.id)} className="text-xs px-2 py-1 rounded" style={{ background: 'transparent', border: '0.5px solid var(--border)', color: 'var(--text-3)', cursor: 'pointer' }}>Remove</button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  )
}

const inp: React.CSSProperties = { background: 'var(--surface-2)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 14 }
