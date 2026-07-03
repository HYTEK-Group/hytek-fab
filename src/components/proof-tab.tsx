'use client'

// The proof-of-work timeline for a job: made → coating (away/back per package) →
// bundled → loaded. Shows a "photographed" gauge and, for a supervisor, buttons to
// add the coating / bundle / on-truck photos. (Finished-piece photos are taken by
// the worker on the floor tablet.) This same pack is what Troy sees on the delivery.
import { useCallback, useEffect, useState } from 'react'
import { PhotoCapture } from './photo-capture'

interface Photo { id: string; url: string | null; mark_label: string | null; taken_by: string; taken_at: string; caption: string | null }
interface Leg { package_id: string | null; treatment_type: string | null; contractor_name: string | null; sent: Photo[]; returned: Photo[] }
interface Pack { made: Photo[]; treatments: Leg[]; bundled: Photo[]; loaded: Photo[]; counts: { marks_photographed: number; treatment_out: number; treatment_in: number; bundled: number; loaded: number; total: number } }
interface Pkg { id: string; treatment_type: string | null; contractor_name: string; package_type: string }

const d = (s: string) => new Date(s).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })

function Thumbs({ photos }: { photos: Photo[] }) {
  if (!photos.length) return <p className="text-xs" style={{ color: 'var(--text-3)' }}>— no photos yet</p>
  return (
    <div className="flex gap-2 flex-wrap">
      {photos.map(p => p.url ? (
        <img key={p.id} src={p.url} alt="" onClick={() => window.open(p.url!, '_blank')}
          style={{ width: 64, height: 52, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', border: '0.5px solid var(--border)' }} />
      ) : (
        <div key={p.id} style={{ width: 64, height: 52, borderRadius: 6, background: 'var(--surface-2)' }} />
      ))}
    </div>
  )
}

export function ProofTab({ jobId, token, role }: { jobId: string; token: string; role: string }) {
  const isSup = role === 'admin' || role === 'supervisor'
  const [pack, setPack] = useState<Pack | null>(null)
  const [totalMarks, setTotalMarks] = useState(0)
  const [pkgs, setPkgs] = useState<Pkg[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      fetch(`/api/fab/jobs/${jobId}/proof`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`/api/fab/jobs/${jobId}/contractor-packages`, { headers: { Authorization: `Bearer ${token}` } }),
    ])
    if (a.ok) { const j = await a.json(); setPack(j.pack); setTotalMarks(j.total_marks ?? 0) }
    if (b.ok) setPkgs(((await b.json()).packages ?? []).filter((p: Pkg) => p.package_type === 'treatment'))
    setLoading(false)
  }, [jobId, token])
  useEffect(() => { load() }, [load])

  if (loading) return <p className="text-sm text-center py-6" style={{ color: 'var(--text-2)' }}>Loading proof…</p>
  const c = pack?.counts

  return (
    <div>
      {/* gauge */}
      <div className="rounded-xl p-3 mb-3" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
        <div className="flex items-center justify-between">
          <span className="text-sm" style={{ color: 'var(--foreground)', fontWeight: 600 }}>Made — {c?.marks_photographed ?? 0} of {totalMarks} pieces photographed</span>
          <span className="text-xs" style={{ color: (c?.marks_photographed ?? 0) >= totalMarks && totalMarks > 0 ? 'var(--success)' : 'var(--text-2)' }}>
            {c ? `${c.treatment_out}/${c.treatment_in} coat · ${c.bundled} bundle · ${c.loaded} truck` : ''}
          </span>
        </div>
        <div className="h-1.5 rounded-full mt-2" style={{ background: 'var(--track)' }}>
          <div className="h-full rounded-full" style={{ background: 'var(--success)', width: totalMarks ? `${Math.min(100, ((c?.marks_photographed ?? 0) / totalMarks) * 100)}%` : '0%' }} />
        </div>
      </div>

      {/* supervisor capture */}
      {isSup && (
        <div className="rounded-xl p-3 mb-3" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
          <p className="text-xs mb-2" style={{ color: 'var(--text-2)' }}>Add proof photos</p>
          <div className="flex gap-2 flex-wrap items-center mb-2">
            <PhotoCapture jobId={jobId} token={token} stage="bundled" label="Bundle" variant="small" onDone={load} />
            <PhotoCapture jobId={jobId} token={token} stage="loaded" label="On the truck" variant="small" onDone={load} />
          </div>
          {pkgs.map(p => (
            <div key={p.id} className="flex items-center gap-2 flex-wrap mt-1">
              <span className="text-xs" style={{ color: 'var(--text-2)', minWidth: 120 }}>{p.treatment_type ?? 'coating'} · {p.contractor_name}</span>
              <PhotoCapture jobId={jobId} token={token} stage="treatment_out" packageId={p.id} treatmentType={p.treatment_type ?? undefined} label="Away" variant="small" onDone={load} />
              <PhotoCapture jobId={jobId} token={token} stage="treatment_in" packageId={p.id} treatmentType={p.treatment_type ?? undefined} label="Back" variant="small" onDone={load} />
            </div>
          ))}
        </div>
      )}

      {/* timeline */}
      <div className="flex flex-col gap-3">
        <Stage title={`Made (${pack?.made.length ?? 0})`}><Thumbs photos={pack?.made ?? []} /></Stage>
        {(pack?.treatments ?? []).map((t, i) => (
          <Stage key={i} title={`${t.treatment_type ?? 'Coating'}${t.contractor_name ? ' — ' + t.contractor_name : ''}`}>
            <div className="flex gap-6 flex-wrap">
              <div><p className="text-xs mb-1" style={{ color: 'var(--warning)' }}>↗ away {t.sent[0] ? d(t.sent[0].taken_at) : ''}</p><Thumbs photos={t.sent} /></div>
              <div><p className="text-xs mb-1" style={{ color: 'var(--success)' }}>↘ back {t.returned[0] ? d(t.returned[0].taken_at) : ''}</p><Thumbs photos={t.returned} /></div>
            </div>
          </Stage>
        ))}
        <Stage title={`Bundled (${pack?.bundled.length ?? 0})`}><Thumbs photos={pack?.bundled ?? []} /></Stage>
        <Stage title={`Loaded on truck (${pack?.loaded.length ?? 0})`}><Thumbs photos={pack?.loaded ?? []} /></Stage>
      </div>
    </div>
  )
}

function Stage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
      <p className="text-sm mb-2" style={{ color: 'var(--foreground)', fontWeight: 500 }}>{title}</p>
      {children}
    </div>
  )
}
