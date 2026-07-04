'use client'

// Office panel: per fabrication sub-package — invite the subcontractor to the
// phone app, watch their made-photo progress live, sight their certs, and (for
// drop-ship) do the formal "accept & release to dispatch" sign-off. Treatment
// packages keep the existing coating flow and are skipped here.
import { useCallback, useEffect, useState } from 'react'

interface Cert { id: string; kind: string; file_name: string; note: string | null; uploaded_by: string; uploaded_at: string; url: string }
interface SubLogin { sub_account_id: string; contractor_name: string; is_active: boolean; pin_set: boolean; revoked: boolean }
interface SubPkg {
  id: string
  package_type: string
  treatment_type: string | null
  contractor_name: string
  contractor_contact: string | null
  scope_note: string | null
  status: string
  delivery_mode: 'return_to_brisbane' | 'drop_ship'
  ready_at: string | null
  drop_ship_released_at: string | null
  drop_ship_released_by: string | null
  sent_at: string | null
  expected_return_date: string | null
  returned_at: string | null
  total_marks: number
  marks_with_made_photo: number
  certs: Cert[]
  sub_logins: SubLogin[]
  drop_ship: null | { can_release: boolean; blockers: string[] }
}

const dm = (s: string) => new Date(s).toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit' })

const chip: React.CSSProperties = {
  background: 'transparent', border: '0.5px solid var(--border)', color: 'var(--text-3)',
  borderRadius: 999, padding: '4px 10px', fontSize: 12, cursor: 'pointer',
}

const MODE_LABEL: Record<SubPkg['delivery_mode'], string> = {
  return_to_brisbane: 'Back to Brisbane',
  drop_ship: 'Straight to site (drop-ship)',
}

export function SubPackagePanel({ jobId, token, role }: { jobId: string; token: string; role: string }) {
  const isSup = role === 'supervisor' || role === 'admin'
  const [pkgs, setPkgs] = useState<SubPkg[] | null>(null)
  const [busy, setBusy] = useState('')                              // '<pkgId>:<action>' in flight
  const [links, setLinks] = useState<Record<string, string>>({})   // pkgId → invite link on show
  const [copied, setCopied] = useState('')                          // pkgId whose link was just copied

  const authJson = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const load = useCallback(async () => {
    const res = await fetch(`/api/fab/jobs/${jobId}/sub-status`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) setPkgs(((await res.json()).packages ?? []) as SubPkg[])
    else setPkgs([])
  }, [jobId, token])
  useEffect(() => { load() }, [load])

  async function setDelivery(p: SubPkg, mode: SubPkg['delivery_mode']) {
    if (mode === p.delivery_mode) return
    setBusy(p.id + ':mode')
    try {
      const res = await fetch(`/api/fab/contractor-packages/${p.id}`, {
        method: 'PATCH', headers: authJson, body: JSON.stringify({ delivery_mode: mode }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(j.error ?? 'Could not change delivery mode — it is locked once drop-ship is released.')
      }
      await load()
    } finally { setBusy('') }
  }

  async function invite(p: SubPkg) {
    setBusy(p.id + ':invite')
    try {
      const aRes = await fetch('/api/fab/sub-accounts', {
        method: 'POST', headers: authJson, body: JSON.stringify({ contractor_name: p.contractor_name }),
      })
      const a = await aRes.json().catch(() => ({}))
      if (!aRes.ok) { alert(a.error ?? 'Could not create the subcontractor login.'); return }
      const gRes = await fetch(`/api/fab/sub-accounts/${a.account.id}/grants`, {
        method: 'POST', headers: authJson, body: JSON.stringify({ package_id: p.id }),
      })
      if (!gRes.ok) {
        const g = await gRes.json().catch(() => ({}))
        alert(g.error ?? 'Login created, but granting this package failed — try again.')
        await load(); return
      }
      setLinks(l => ({ ...l, [p.id]: a.account.invite_link }))
      await load()
    } finally { setBusy('') }
  }

  // Toggle the invite link for a package that already has access (reuse returns the same link).
  async function showLink(p: SubPkg) {
    if (links[p.id]) { setLinks(l => { const n = { ...l }; delete n[p.id]; return n }); return }
    setBusy(p.id + ':link')
    try {
      const res = await fetch('/api/fab/sub-accounts', {
        method: 'POST', headers: authJson, body: JSON.stringify({ contractor_name: p.contractor_name }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { alert(j.error ?? 'Could not fetch the invite link.'); return }
      setLinks(l => ({ ...l, [p.id]: j.account.invite_link }))
    } finally { setBusy('') }
  }

  async function revoke(p: SubPkg, accountId: string) {
    if (!confirm(`Revoke ${p.contractor_name}'s app access to this package?`)) return
    setBusy(p.id + ':revoke')
    try {
      const res = await fetch(`/api/fab/sub-accounts/${accountId}/grants`, {
        method: 'PATCH', headers: authJson, body: JSON.stringify({ package_id: p.id }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(j.error ?? 'Could not revoke access.')
      }
      setLinks(l => { const n = { ...l }; delete n[p.id]; return n })
      await load()
    } finally { setBusy('') }
  }

  async function release(p: SubPkg) {
    if (!confirm('This steel ships straight to site WITHOUT HYTEK QC. Certs sighted?')) return
    setBusy(p.id + ':release')
    try {
      const res = await fetch(`/api/fab/contractor-packages/${p.id}/dropship-release`, {
        method: 'POST', headers: authJson, body: JSON.stringify({}),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(j.blockers?.length ? 'Not ready to release:\n✗ ' + j.blockers.join('\n✗ ') : (j.error ?? 'Release failed.'))
      }
      await load()
    } finally { setBusy('') }
  }

  function copyLink(pkgId: string, link: string) {
    navigator.clipboard.writeText(link)
    setCopied(pkgId)
    setTimeout(() => setCopied(c => (c === pkgId ? '' : c)), 1500)
  }

  if (pkgs === null) return <p className="text-sm text-center py-4" style={{ color: 'var(--text-2)' }}>Loading subcontractor status…</p>

  if (pkgs.length === 0)
    return (
      <div className="rounded-xl p-3 mt-4" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>No contractor packages yet — create one above to subcontract work.</p>
      </div>
    )

  const fab = pkgs.filter(p => p.package_type !== 'treatment')

  return (
    <div className="mt-4">
      <p className="text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>Subcontractor access &amp; proof</p>

      {fab.length === 0 && (
        <div className="rounded-xl p-3" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>Only treatment packages here — they keep the existing coating flow.</p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {fab.map(p => {
          const released = !!p.drop_ship_released_at
          const active = p.sub_logins.find(l => l.is_active && !l.revoked)
          const link = links[p.id]
          const madePct = p.total_marks ? Math.min(100, (p.marks_with_made_photo / p.total_marks) * 100) : 0
          return (
            <div key={p.id} className="rounded-xl p-3" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
              {/* Header: name + status + delivery-mode toggle */}
              <div className="flex justify-between items-start gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>{p.contractor_name}{p.scope_note ? ` — ${p.scope_note}` : ''}</p>
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ border: '0.5px solid var(--hytek-yellow)', color: 'var(--foreground)', fontWeight: 700 }}>{p.status}</span>
                </div>
                {isSup ? (
                  <div className="flex gap-1 flex-shrink-0">
                    {(['return_to_brisbane', 'drop_ship'] as const).map(mode => (
                      <button key={mode} onClick={() => setDelivery(p, mode)} disabled={released || busy === p.id + ':mode'}
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{
                          background: p.delivery_mode === mode ? 'var(--chip-brand-bg)' : 'transparent',
                          border: `0.5px solid ${p.delivery_mode === mode ? 'var(--hytek-yellow)' : 'var(--border)'}`,
                          color: p.delivery_mode === mode ? 'var(--foreground)' : 'var(--text-3)',
                          fontWeight: p.delivery_mode === mode ? 700 : 400,
                          cursor: released ? 'default' : 'pointer',
                          opacity: busy === p.id + ':mode' ? .5 : released && p.delivery_mode !== mode ? .4 : 1,
                        }}>
                        {MODE_LABEL[mode]}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs px-2 py-0.5 rounded-full flex-shrink-0" style={{ border: '0.5px solid var(--border)', color: 'var(--text-2)' }}>
                    {MODE_LABEL[p.delivery_mode]}
                  </span>
                )}
              </div>
              {released && isSup && (
                <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>🔒 Delivery mode locked — drop-ship already released.</p>
              )}

              {/* Live from the sub */}
              <div className="flex items-center gap-3 mt-2">
                <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-2)' }}>📷 {p.marks_with_made_photo}/{p.total_marks} photographed</span>
                <div className="flex-1 rounded-full h-1.5" style={{ background: 'var(--track)' }}>
                  <div className="h-full rounded-full" style={{ background: 'var(--success)', width: `${madePct}%` }} />
                </div>
                {p.ready_at && (
                  <span className="text-xs px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: 'var(--chip-success-bg)', border: '0.5px solid var(--success)', color: 'var(--success)' }}>
                    Ready to collect ✓ {dm(p.ready_at)}
                  </span>
                )}
              </div>

              {/* App access / invite */}
              <div className="mt-2 pt-2" style={{ borderTop: '0.5px solid var(--border)' }}>
                {active ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--chip-brand-bg)', border: '0.5px solid var(--hytek-yellow)', color: 'var(--foreground)', fontWeight: 700 }}>
                      📱 {active.contractor_name} has app access
                    </span>
                    <span className="text-xs" style={{ color: active.pin_set ? 'var(--success)' : 'var(--text-3)' }}>
                      {active.pin_set ? 'PIN set ✓' : 'waiting for first open'}
                    </span>
                    {isSup && (
                      <>
                        <button onClick={() => showLink(p)} disabled={busy === p.id + ':link'} style={{ ...chip, opacity: busy === p.id + ':link' ? .5 : 1 }}>
                          {busy === p.id + ':link' ? 'Fetching…' : link ? 'Hide invite link' : 'Show invite link'}
                        </button>
                        <button onClick={() => revoke(p, active.sub_account_id)} disabled={busy === p.id + ':revoke'}
                          style={{ ...chip, borderColor: 'var(--danger)', color: 'var(--danger)', opacity: busy === p.id + ':revoke' ? .5 : 1 }}>
                          {busy === p.id + ':revoke' ? 'Revoking…' : 'Revoke access'}
                        </button>
                      </>
                    )}
                  </div>
                ) : isSup ? (
                  <button onClick={() => invite(p)} disabled={busy === p.id + ':invite'} className="text-xs px-3 py-1.5 rounded-lg font-medium"
                    style={{ background: 'var(--hytek-yellow)', color: 'var(--on-brand)', border: 'none', opacity: busy === p.id + ':invite' ? .5 : 1 }}>
                    {busy === p.id + ':invite' ? 'Creating login…' : '🔗 Invite subcontractor'}
                  </button>
                ) : (
                  <p className="text-xs" style={{ color: 'var(--text-3)' }}>No app access set up yet.</p>
                )}
                {link && (
                  <div className="mt-2">
                    <div className="flex gap-2 items-center">
                      <input readOnly value={link} onFocus={e => e.target.select()} className="text-xs flex-1"
                        style={{ background: 'var(--surface-2)', border: '0.5px solid var(--border)', borderRadius: 6, padding: '4px 6px', color: 'var(--text-2)' }} />
                      <button onClick={() => copyLink(p.id, link)} style={{ ...chip, color: copied === p.id ? 'var(--success)' : chip.color }}>
                        {copied === p.id ? '✓ Copied' : 'Copy'}
                      </button>
                    </div>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Text this link to the sub — they set a 4-digit PIN on first open.</p>
                  </div>
                )}
              </div>

              {/* Certs from the sub */}
              <div className="mt-2 pt-2" style={{ borderTop: '0.5px solid var(--border)' }}>
                <p className="text-xs mb-1" style={{ color: 'var(--text-2)' }}>Certs from the sub</p>
                {p.certs.length === 0 && <p className="text-xs" style={{ color: 'var(--text-3)' }}>No certs from the sub yet</p>}
                <div className="flex flex-col gap-1">
                  {p.certs.map(c => (
                    <div key={c.id} className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ border: '0.5px solid var(--info)', color: 'var(--info)', fontWeight: 700 }}>{c.kind.toUpperCase()}</span>
                      <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-xs truncate" style={{ color: 'var(--foreground)', fontWeight: 600 }}>{c.file_name}</a>
                      <span className="text-xs" style={{ color: 'var(--text-3)' }}>{c.uploaded_by} · {dm(c.uploaded_at)}</span>
                      {c.note && <span className="text-xs" style={{ color: 'var(--text-3)' }}>— {c.note}</span>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Drop-ship sign-off */}
              {p.delivery_mode === 'drop_ship' && (
                <div className="mt-2 pt-2" style={{ borderTop: '0.5px solid var(--border)' }}>
                  {p.drop_ship_released_at ? (
                    <div className="rounded-lg p-2" style={{ background: 'var(--chip-success-bg)', border: '0.5px solid var(--success)' }}>
                      <p className="text-xs" style={{ color: 'var(--success)', fontWeight: 600 }}>
                        ✓ Drop-ship released by {p.drop_ship_released_by ?? '—'} on {dm(p.drop_ship_released_at)} — steel is dispatch-ready from the sub&apos;s yard
                      </p>
                    </div>
                  ) : (
                    <>
                      <p className="text-xs mb-1" style={{ color: 'var(--text-2)' }}>Drop-ship sign-off</p>
                      {(p.drop_ship?.blockers ?? []).map((b, i) => (
                        <p key={i} className="text-xs" style={{ color: 'var(--warning)' }}>✗ {b}</p>
                      ))}
                      {p.drop_ship?.can_release && isSup && (
                        <button onClick={() => release(p)} disabled={busy === p.id + ':release'} className="w-full rounded-lg text-sm font-medium mt-2"
                          style={{ background: 'var(--hytek-yellow)', color: 'var(--on-brand)', padding: '10px', border: 'none', fontWeight: 600, opacity: busy === p.id + ':release' ? .5 : 1 }}>
                          {busy === p.id + ':release' ? 'Releasing…' : 'Accept drop-ship & release to dispatch'}
                        </button>
                      )}
                      {p.drop_ship?.can_release && !isSup && (
                        <p className="text-xs mt-1" style={{ color: 'var(--success)' }}>All checks passed — a supervisor can release to dispatch.</p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
