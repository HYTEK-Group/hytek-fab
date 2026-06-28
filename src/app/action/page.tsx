'use client'

// Action Centre — the supervisor's home. One screen that pulls together, across
// ALL jobs, everything that needs action (QC, dispatch, contractor packages),
// each a single tap straight to the right tab. Replaces opening every job and
// checking every tab.
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { AppShell } from '@/components/app-shell'
import { supabase } from '@/lib/supabase'
import type { FabJob } from '@/lib/types'

interface Row extends FabJob {
  qc_waiting: number
  dispatch_ready: number
  packages_out: number
  packages_overdue: number
}

const card: React.CSSProperties = {
  background: '#1e1e21', border: '0.5px solid #2a2a2a', borderRadius: 10,
  padding: '10px 12px', cursor: 'pointer', textAlign: 'left', width: '100%', marginBottom: 6,
}

export default function ActionCentrePage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [jobs, setJobs] = useState<Row[]>([])
  const [fetching, setFetching] = useState(true)

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const res = await fetch('/api/fab/jobs', { headers: { Authorization: `Bearer ${session.access_token}` } })
    if (res.ok) setJobs((await res.json()).jobs ?? [])
    setFetching(false)
  }, [])

  useEffect(() => { if (!loading && !user) router.push('/login') }, [user, loading, router])
  useEffect(() => { if (user) load() }, [user, load])

  if (loading || !user) return null

  const qc = jobs.filter(j => j.qc_waiting > 0)
  const disp = jobs.filter(j => j.dispatch_ready > 0)
  const pkg = jobs.filter(j => j.packages_out > 0)
  const sum = (a: Row[], k: keyof Row) => a.reduce((s, j) => s + (j[k] as number), 0)
  const allClear = !qc.length && !disp.length && !pkg.length
  const go = (id: string, tab: string) => router.push(`/jobs/${id}?tab=${tab}`)
  const head = (label: string) => (
    <span style={{ color: '#fff' }}><span style={{ color: '#FFCB05' }}>{label}</span></span>
  )

  return (
    <AppShell>
      <div className="p-4 max-w-2xl mx-auto">
        <h1 className="text-lg font-semibold mb-1" style={{ color: '#FFCB05' }}>Action Centre</h1>
        <p className="text-xs mb-4" style={{ color: '#666' }}>Everything across all jobs that needs you — tap straight to it.</p>

        {fetching && <p className="text-sm" style={{ color: '#555' }}>Loading…</p>}

        {!fetching && allClear && (
          <div className="rounded-xl p-6 text-center" style={{ background: '#1e1e21', border: '0.5px solid #2a2a2a' }}>
            <p style={{ color: '#97C459' }}>✓ All clear — nothing waiting on you.</p>
          </div>
        )}

        {!fetching && !allClear && (
          <>
            {/* QC */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold" style={{ color: '#FFCB05' }}>Needs QC</h2>
                <span className="text-xs" style={{ color: '#777' }}>{sum(qc, 'qc_waiting')} marks</span>
              </div>
              {qc.length === 0 ? <p className="text-xs" style={{ color: '#444' }}>Nothing waiting.</p> : qc.map(j => (
                <button key={j.id} style={card} onClick={() => go(j.id, 'qc')}>
                  <div className="flex justify-between items-center">
                    {head(`${j.quote_number} `)}<span style={{ color: '#aaa', flex: 1 }}> {j.name}</span>
                    <span style={{ color: '#FFCB05' }}>{j.qc_waiting} to QC →</span>
                  </div>
                </button>
              ))}
            </div>

            {/* Dispatch */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold" style={{ color: '#63D297' }}>Ready to dispatch</h2>
                <span className="text-xs" style={{ color: '#777' }}>{sum(disp, 'dispatch_ready')} marks</span>
              </div>
              {disp.length === 0 ? <p className="text-xs" style={{ color: '#444' }}>Nothing waiting.</p> : disp.map(j => (
                <button key={j.id} style={card} onClick={() => go(j.id, 'dispatch')}>
                  <div className="flex justify-between items-center">
                    {head(`${j.quote_number} `)}<span style={{ color: '#aaa', flex: 1 }}> {j.name}</span>
                    <span style={{ color: '#63D297' }}>{j.dispatch_ready} ready →</span>
                  </div>
                </button>
              ))}
            </div>

            {/* Packages */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold" style={{ color: '#85B7EB' }}>Contractor packages out</h2>
                <span className="text-xs" style={{ color: '#777' }}>{sum(pkg, 'packages_out')}{sum(pkg, 'packages_overdue') > 0 ? ` · ${sum(pkg, 'packages_overdue')} overdue` : ''}</span>
              </div>
              {pkg.length === 0 ? <p className="text-xs" style={{ color: '#444' }}>Nothing out.</p> : pkg.map(j => (
                <button key={j.id} style={card} onClick={() => go(j.id, 'packages')}>
                  <div className="flex justify-between items-center">
                    {head(`${j.quote_number} `)}<span style={{ color: '#aaa', flex: 1 }}> {j.name}</span>
                    <span style={{ color: j.packages_overdue > 0 ? '#ff6b6b' : '#85B7EB' }}>
                      {j.packages_out} out{j.packages_overdue > 0 ? ` · ${j.packages_overdue} overdue` : ''} →
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        <p className="mt-2 text-xs" style={{ color: '#555' }}>
          New job? Open it from <strong>Shop</strong> and use <strong>Marks → Import</strong> to load the Tekla Assembly List.
        </p>
      </div>
    </AppShell>
  )
}
