'use client'

// Gatekeeper — the exceptions report. Every sensitive action on the traceability
// record (shipping un-photographed steel, pushing proven work back, moving a
// promised on-site date, pulling a photographed piece out of a delivery, deleting
// a stage that holds proof) surfaces here as an OPEN exception until a SECOND
// admin — never the person who raised it — clears it. Clearing is itself logged
// to the append-only audit, so the control can't be undone.
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { AppShell } from '@/components/app-shell'
import { supabase } from '@/lib/supabase'

interface Exc {
  id: string
  fab_job_id: string | null
  kind: string
  actor: string
  detail: unknown
  created_at: string
  cleared_by: string | null
  cleared_at: string | null
  clear_note: string | null
  job_label: string | null
  clearable: boolean
}

const KIND_LABEL: Record<string, string> = {
  dispatch_override: 'Shipped without full photos',
  mark_status_reverted: 'Proven work pushed back',
  onsite_date_changed: 'On-site date moved',
  proven_piece_unstaged: 'Photographed piece pulled from delivery',
  stage_deleted_with_proof: 'Delivery stage with proof deleted',
}

const card: React.CSSProperties = {
  background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10,
  padding: '12px 14px', marginBottom: 8,
}
const when = (s: string) => new Date(s).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

function summarise(kind: string, detail: unknown): string {
  const d = (detail ?? {}) as Record<string, unknown>
  const marks = (v: unknown) => Array.isArray(v) ? (v as unknown[]).map(String).join(', ') : ''
  switch (kind) {
    case 'dispatch_override': {
      const n = Array.isArray(d.missing_marks) ? (d.missing_marks as unknown[]).length : d.total
      return `${n ?? '?'} piece(s) un-photographed — reason: “${String(d.reason ?? '')}”`
    }
    case 'mark_status_reverted': {
      const rev = Array.isArray(d.reverted) ? (d.reverted as { mark_id?: string; from?: string }[]) : []
      return `→ ${String(d.to ?? '')}: ${rev.map(r => `${r.mark_id} (was ${r.from})`).join(', ')}`
    }
    case 'onsite_date_changed':
      return `${String(d.from ?? '')} → ${String(d.to ?? '—')}${d.stage ? ` (${String(d.stage)})` : ''}`
    case 'proven_piece_unstaged':
      return `${d.proven_count ?? ''} proven: ${marks(d.proven_marks)}`
    case 'stage_deleted_with_proof':
      return `${d.stage ? `${String(d.stage)} — ` : ''}${d.proven_count ?? ''} proven piece(s): ${marks(d.proven_marks)}`
    default:
      return ''
  }
}

export default function ExceptionsPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [open, setOpen] = useState<Exc[]>([])
  const [cleared, setCleared] = useState<Exc[]>([])
  const [fetching, setFetching] = useState(true)
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const res = await fetch('/api/fab/exceptions', { headers: { Authorization: `Bearer ${session.access_token}` } })
    if (res.ok) { const j = await res.json(); setOpen(j.open ?? []); setCleared(j.cleared ?? []) }
    setFetching(false)
  }, [])

  useEffect(() => { if (!loading && !user) router.push('/login') }, [user, loading, router])
  useEffect(() => { if (user) load() }, [user, load])

  async function clear(id: string) {
    const note = window.prompt('Clearing this exception is logged against your name. Add a note (optional):', '')
    if (note === null) return // cancelled
    setBusy(id)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/fab/exceptions/${id}/clear`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    })
    setBusy('')
    if (!res.ok) { const e = await res.json().catch(() => ({})); window.alert(e.error ?? 'Could not clear.'); return }
    load()
  }

  if (loading || !user) return null

  return (
    <AppShell>
      <div className="p-4 max-w-2xl mx-auto">
        <h1 className="text-lg font-semibold mb-1" style={{ color: 'var(--foreground)', fontWeight: 700 }}>Gatekeeper</h1>
        <p className="text-xs mb-4" style={{ color: 'var(--text-2)' }}>
          Sensitive changes to the traceability record. Each stays OPEN until a different admin clears it — four-eyes.
        </p>

        {fetching && <p className="text-sm" style={{ color: 'var(--text-2)' }}>Loading…</p>}

        {!fetching && (
          <>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold" style={{ color: open.length ? 'var(--warning, #9a6206)' : 'var(--success)' }}>
                {open.length ? `${open.length} open — need clearing` : 'Nothing open'}
              </h2>
            </div>
            {open.length === 0 && (
              <div className="rounded-xl p-6 text-center mb-6" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
                <p style={{ color: 'var(--success)' }}>✓ No open exceptions — the record is clean.</p>
              </div>
            )}
            {open.map(e => (
              <div key={e.id} style={{ ...card, borderLeft: '3px solid var(--warning, #9a6206)' }}>
                <div className="flex items-start justify-between gap-2">
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: 'var(--foreground)' }}>{KIND_LABEL[e.kind] ?? e.kind}</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>{e.job_label ?? '(no job)'}</div>
                    <div className="text-xs mt-1" style={{ color: 'var(--foreground)' }}>{summarise(e.kind, e.detail)}</div>
                    <div className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>by {e.actor} · {when(e.created_at)}</div>
                  </div>
                  {e.clearable ? (
                    <button onClick={() => clear(e.id)} disabled={busy === e.id}
                      className="text-xs px-3 py-1.5 rounded font-medium"
                      style={{ background: 'var(--hytek-yellow)', color: 'var(--on-brand)', border: 'none', whiteSpace: 'nowrap' }}>
                      {busy === e.id ? '…' : 'Clear'}
                    </button>
                  ) : (
                    <span className="text-xs" style={{ color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                      {open.length ? 'needs another admin' : ''}
                    </span>
                  )}
                </div>
              </div>
            ))}

            {cleared.length > 0 && (
              <>
                <h2 className="text-sm font-semibold mt-6 mb-2" style={{ color: 'var(--text-2)' }}>Recently cleared</h2>
                {cleared.slice(0, 50).map(e => (
                  <div key={e.id} style={{ ...card, opacity: 0.75 }}>
                    <div className="flex items-start justify-between gap-2">
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, color: 'var(--foreground)' }}>{KIND_LABEL[e.kind] ?? e.kind}</div>
                        <div className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>{e.job_label ?? '(no job)'}</div>
                        <div className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>{summarise(e.kind, e.detail)}</div>
                        <div className="text-xs mt-1" style={{ color: 'var(--success)' }}>
                          ✓ cleared by {e.cleared_by} · {e.cleared_at ? when(e.cleared_at) : ''}{e.clear_note ? ` — “${e.clear_note}”` : ''}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}
