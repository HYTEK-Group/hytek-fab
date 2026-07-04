'use client'

// Subcontractors console — the office home for external fabricators who make our
// steel. See every sub firm, copy their app invite link, see which jobs they're
// on, and cut off access. (The per-job invite still happens from a job's
// Packages tab — that's where you release specific pieces to a sub.)
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { AppShell } from '@/components/app-shell'
import { supabase } from '@/lib/supabase'

interface SubJob {
  package_id: string
  quote_number: string | null
  job_name: string | null
  delivery_mode: 'return_to_brisbane' | 'drop_ship'
  status: string
  ready_at: string | null
  dropship_released: boolean
}
interface Sub {
  id: string
  contractor_name: string
  is_active: boolean
  pin_set: boolean
  created_at: string
  invite_link: string
  jobs: SubJob[]
}

const card: React.CSSProperties = {
  background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 12,
  padding: 14, marginBottom: 12,
}
const chip = (bg: string, fg: string): React.CSSProperties => ({
  fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: bg, color: fg,
})

export default function SubsPage() {
  const { user, profile, loading } = useAuth()
  const router = useRouter()
  const [subs, setSubs] = useState<Sub[]>([])
  const [fetching, setFetching] = useState(true)
  const [token, setToken] = useState('')
  const [copied, setCopied] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    setToken(session.access_token)
    const res = await fetch('/api/fab/subs-overview', { headers: { Authorization: `Bearer ${session.access_token}` } })
    if (res.ok) setSubs((await res.json()).subs ?? [])
    setFetching(false)
  }, [])

  useEffect(() => {
    let stale = false
    ;(async () => {
      await Promise.resolve() // yield a tick so setState lands outside the sync effect body
      if (stale) return
      if (!loading && !user) { router.push('/login'); return }
      if (user) load()
    })()
    return () => { stale = true }
  }, [user, loading, load, router])

  const isSup = profile?.role === 'admin' || profile?.role === 'supervisor'

  async function copyLink(link: string, id: string) {
    try { await navigator.clipboard.writeText(link); setCopied(id); setTimeout(() => setCopied(''), 1500) } catch { /* clipboard blocked */ }
  }
  async function setActive(id: string, is_active: boolean) {
    if (!is_active && !confirm('Cut off this subcontractor’s app access? They will not be able to sign in until re-enabled.')) return
    setBusy(id)
    await fetch(`/api/fab/sub-accounts/${id}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active }),
    })
    setBusy(''); load()
  }
  async function resetPin(id: string) {
    if (!confirm('Reset this sub’s PIN? They’ll set a new one the next time they open the link.')) return
    setBusy(id)
    await fetch(`/api/fab/sub-accounts/${id}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reset_pin: true }),
    })
    setBusy(''); load()
  }
  async function revokeJob(subId: string, packageId: string) {
    if (!confirm('Remove this job from the sub’s app? Their photos + certs stay as evidence; they just lose access to it.')) return
    setBusy(subId + packageId)
    await fetch(`/api/fab/sub-accounts/${subId}/grants`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ package_id: packageId }),
    })
    setBusy(''); load()
  }

  if (loading || !user) return null

  return (
    <AppShell>
      <div className="p-4 max-w-2xl mx-auto">
        <h1 className="text-lg font-semibold mb-1" style={{ color: 'var(--foreground)', fontWeight: 700 }}>Subcontractors</h1>
        <p className="text-xs mb-4" style={{ color: 'var(--text-2)' }}>
          External fabricators with app access. Text a sub their link to get them started; release specific pieces to them from a job&apos;s Packages tab.
        </p>

        {fetching && <p className="text-sm" style={{ color: 'var(--text-2)' }}>Loading…</p>}

        {!fetching && subs.length === 0 && (
          <div className="rounded-xl p-6 text-center" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
            <p style={{ color: 'var(--text-2)' }}>No subcontractors yet.</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Open a job → Packages → &quot;Invite subcontractor&quot; to create one.</p>
          </div>
        )}

        {subs.map(s => (
          <div key={s.id} style={{ ...card, opacity: s.is_active ? 1 : 0.6 }}>
            <div className="flex items-center justify-between gap-2 flex-wrap" style={{ marginBottom: 8 }}>
              <div className="flex items-center gap-2 flex-wrap">
                <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--foreground)' }}>{s.contractor_name}</span>
                {s.is_active
                  ? <span style={chip('var(--chip-success-bg, rgba(21,128,61,.1))', 'var(--success)')}>active</span>
                  : <span style={chip('var(--surface-2)', 'var(--text-2)')}>disabled</span>}
                <span style={chip('var(--surface-2)', s.pin_set ? 'var(--success)' : 'var(--text-2)')}>
                  {s.pin_set ? 'PIN set' : 'waiting for first open'}
                </span>
              </div>
              {isSup && (
                <div className="flex items-center gap-2">
                  {s.pin_set && s.is_active && (
                    <button onClick={() => resetPin(s.id)} disabled={busy === s.id}
                      className="text-xs px-2 py-1 rounded" style={{ color: 'var(--text-2)', background: 'transparent', border: '0.5px solid var(--border)' }}>
                      Reset PIN
                    </button>
                  )}
                  <button onClick={() => setActive(s.id, !s.is_active)} disabled={busy === s.id}
                    className="text-xs px-2 py-1 rounded" style={{ color: s.is_active ? 'var(--danger)' : 'var(--success)', background: 'transparent', border: `0.5px solid ${s.is_active ? 'var(--danger)' : 'var(--border)'}` }}>
                    {s.is_active ? 'Disable access' : 'Re-enable'}
                  </button>
                </div>
              )}
            </div>

            {/* invite link */}
            <div className="flex items-center gap-2" style={{ marginBottom: s.jobs.length ? 10 : 0 }}>
              <input readOnly value={s.invite_link} onFocus={e => e.currentTarget.select()}
                style={{ flex: 1, minWidth: 0, fontSize: 12, background: 'var(--surface-2)', color: 'var(--text-2)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '7px 10px' }} />
              <button onClick={() => copyLink(s.invite_link, s.id)}
                className="text-xs px-3 py-1.5 rounded font-medium" style={{ background: 'var(--hytek-yellow)', color: 'var(--on-brand)', border: 'none', flexShrink: 0 }}>
                {copied === s.id ? '✓ Copied' : 'Copy link'}
              </button>
            </div>

            {/* jobs this sub is on */}
            {s.jobs.length === 0
              ? <p className="text-xs" style={{ color: 'var(--text-3)' }}>No jobs released to them right now.</p>
              : s.jobs.map(j => (
                <div key={j.package_id} className="flex items-center justify-between gap-2" style={{ padding: '7px 0', borderTop: '0.5px solid var(--border)' }}>
                  <div style={{ minWidth: 0 }}>
                    <button onClick={() => j.quote_number && router.push(`/jobs?tab=packages`)} style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>{j.quote_number ?? 'job'}</span>
                      {j.job_name && <span style={{ fontSize: 12, color: 'var(--text-2)' }}> · {j.job_name}</span>}
                    </button>
                    <div className="flex items-center gap-1.5 flex-wrap" style={{ marginTop: 2 }}>
                      <span style={chip('var(--surface-2)', 'var(--text-2)')}>{j.delivery_mode === 'drop_ship' ? 'drop-ship' : 'to Brisbane'}</span>
                      {j.dropship_released
                        ? <span style={chip('var(--chip-success-bg, rgba(21,128,61,.1))', 'var(--success)')}>released</span>
                        : j.ready_at
                          ? <span style={chip('var(--surface-2)', 'var(--info)')}>ready to collect</span>
                          : <span style={chip('var(--surface-2)', 'var(--text-2)')}>{j.status}</span>}
                    </div>
                  </div>
                  {isSup && (
                    <button onClick={() => revokeJob(s.id, j.package_id)} disabled={busy === s.id + j.package_id}
                      className="text-xs px-2 py-1 rounded" style={{ color: 'var(--danger)', background: 'transparent', border: '0.5px solid var(--border)', flexShrink: 0 }}>
                      Remove
                    </button>
                  )}
                </div>
              ))}
          </div>
        ))}
      </div>
    </AppShell>
  )
}
