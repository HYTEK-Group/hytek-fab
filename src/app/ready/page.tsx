'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { AppShell } from '@/components/app-shell'
import { supabase } from '@/lib/supabase'
import type { ReadyQueueItem } from '@/lib/types'

export default function ReadyQueuePage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [items, setItems] = useState<ReadyQueueItem[]>([])
  const [fetching, setFetching] = useState(true)
  const [starting, setStarting] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    setFetching(true)
    const res = await fetch('/api/fab/ready-queue', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    if (res.ok) setItems((await res.json()).items ?? [])
    setFetching(false)
  }, [])

  useEffect(() => { if (!loading && !user) router.push('/login') }, [user, loading, router])
  useEffect(() => { if (user) load() }, [user, load])

  async function startJob(item: ReadyQueueItem) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    setStarting(item.quote_number)
    const res = await fetch('/api/fab/jobs', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        quote_number: item.quote_number,
        hubspot_deal_id: item.hubspot_deal_id,
        name: item.name,
        client: item.client,
        on_site_date: item.on_site_date,
      }),
    })
    setStarting(null)
    if (res.ok) {
      const { job } = await res.json()
      router.push(`/jobs/${job.id}`)
    }
  }

  if (loading || !user) return null

  return (
    <AppShell>
      <div className="p-4 max-w-2xl mx-auto">
        <p className="text-xs mb-3" style={{ color: '#555', textTransform: 'uppercase', letterSpacing: '.07em' }}>
          {fetching ? 'Checking Hub…' : `${items.length} job${items.length !== 1 ? 's' : ''} ready to start`}
        </p>

        {items.length === 0 && !fetching && (
          <div className="rounded-xl p-6 text-center" style={{ background: '#1e1e21', border: '0.5px solid #2a2a2a' }}>
            <p style={{ color: '#555' }}>No jobs ready. Waiting for drawings and steel delivery signals from Hub.</p>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {items.map(item => (
            <div key={item.quote_number} className="rounded-xl p-3" style={{ background: '#1e1e21', border: '0.5px solid #2a2a2a' }}>
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-medium" style={{ color: '#FFCB05' }}>{item.quote_number}</span>
                {item.on_site_date && (
                  <span className="text-xs" style={{ color: '#555' }}>On site {item.on_site_date}</span>
                )}
              </div>
              <p className="text-sm font-medium mb-0.5" style={{ color: '#fff' }}>{item.name}</p>
              <p className="text-xs mb-3" style={{ color: '#666' }}>{item.client ?? '—'}</p>

              <div className="flex gap-2 flex-wrap mb-3">
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={item.ss_drawings_issued
                    ? { background: 'rgba(99,153,34,.15)', color: '#97C459', border: '0.5px solid rgba(99,153,34,.3)' }
                    : { background: 'rgba(136,136,136,.1)', color: '#555', border: '0.5px solid #2a2a2a' }}
                >
                  {item.ss_released
                    ? `✓ Released to factory${item.release_version ? ` (v${item.release_version})` : ''}`
                    : item.ss_drawings_issued ? '✓ Drawings issued' : '⧖ Awaiting release'}
                </span>
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={item.materials_received
                    ? { background: 'rgba(99,153,34,.15)', color: '#97C459', border: '0.5px solid rgba(99,153,34,.3)' }
                    : { background: 'rgba(186,117,23,.15)', color: '#EF9F27', border: '0.5px solid rgba(186,117,23,.3)' }}
                >
                  {item.materials_received ? '✓ Steel on site' : '⧖ Awaiting steel'}
                </span>
              </div>

              {item.ready ? (
                <button
                  onClick={() => startJob(item)}
                  disabled={starting === item.quote_number}
                  className="w-full rounded-lg text-sm font-medium"
                  style={{
                    background: starting === item.quote_number ? '#888' : '#FFCB05',
                    color: '#231F20',
                    padding: '10px',
                    border: 'none',
                    cursor: starting === item.quote_number ? 'not-allowed' : 'pointer',
                  }}
                >
                  {starting === item.quote_number ? 'Starting…' : 'Start fabrication'}
                </button>
              ) : (
                <button
                  disabled
                  className="w-full rounded-lg text-sm"
                  style={{ background: 'transparent', border: '0.5px solid #333', color: '#555', padding: '10px', cursor: 'not-allowed' }}
                >
                  Waiting on {!item.ss_drawings_issued ? 'drawings' : 'steel delivery'}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  )
}
