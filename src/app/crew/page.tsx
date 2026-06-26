'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { AppShell } from '@/components/app-shell'
import { supabase } from '@/lib/supabase'

interface CrewMember {
  worker_name: string
  tasks: Array<{ description: string; status: string; job_name: string; quote_number: string }>
  hours_today: number
  current_job: string | null
  current_quote: string | null
}

export default function CrewPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [crew, setCrew] = useState<CrewMember[]>([])
  const [date, setDate] = useState('')
  const [fetching, setFetching] = useState(true)

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const res = await fetch('/api/fab/crew', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    if (res.ok) {
      const json = await res.json()
      setCrew(json.crew ?? [])
      setDate(json.date ?? '')
    }
    setFetching(false)
  }, [])

  useEffect(() => { if (!loading && !user) router.push('/login') }, [user, loading, router])
  useEffect(() => { if (user) load() }, [user, load])

  if (loading || !user) return null

  const assigned = crew.filter(c => c.tasks.length > 0)
  const unassigned = crew.filter(c => c.tasks.length === 0)

  return (
    <AppShell>
      <div className="p-4 max-w-2xl mx-auto">
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[
            { label: 'Workers today', value: crew.length },
            { label: 'Hrs logged', value: crew.reduce((s, c) => s + c.hours_today, 0).toFixed(1) },
            { label: 'Unassigned', value: unassigned.length, warn: unassigned.length > 0 },
          ].map(s => (
            <div key={s.label} className="rounded-xl p-3" style={{ background: '#1e1e21', border: '0.5px solid #2a2a2a' }}>
              <p className="text-xs mb-1" style={{ color: '#555' }}>{s.label}</p>
              <p className="text-xl font-medium" style={{ color: s.warn ? '#EF9F27' : '#fff' }}>{s.value}</p>
            </div>
          ))}
        </div>

        <p className="text-xs mb-2" style={{ color: '#555', textTransform: 'uppercase', letterSpacing: '.07em' }}>
          {fetching ? 'Loading…' : date}
        </p>

        <div className="flex flex-col gap-2">
          {assigned.map(member => (
            <div key={member.worker_name} className="rounded-xl p-3 flex gap-3" style={{ background: '#1e1e21', border: '0.5px solid #2a2a2a' }}>
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0"
                style={{ background: '#FFCB05', color: '#231F20' }}
              >
                {member.worker_name.split(' ').map(n => n[0]).join('').slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium mb-0.5" style={{ color: '#fff' }}>{member.worker_name}</p>
                <p className="text-xs mb-1 truncate" style={{ color: '#777' }}>
                  {member.tasks[0]?.description ?? '—'}
                </p>
                {member.tasks.length > 1 && (
                  <p className="text-xs" style={{ color: '#555' }}>+{member.tasks.length - 1} more task{member.tasks.length > 2 ? 's' : ''}</p>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-xs font-medium" style={{ color: '#FFCB05' }}>{member.current_quote ?? '—'}</p>
                <p className="text-xs mt-0.5" style={{ color: '#555' }}>{member.hours_today.toFixed(1)} hrs</p>
              </div>
            </div>
          ))}

          {unassigned.map(member => (
            <div key={member.worker_name} className="rounded-xl p-3 flex gap-3" style={{ background: '#1e1e21', border: '0.5px solid #2a2a2a' }}>
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0"
                style={{ background: '#2a2a2a', color: '#555' }}
              >
                {member.worker_name.split(' ').map(n => n[0]).join('').slice(0, 2)}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium mb-0.5" style={{ color: '#888' }}>{member.worker_name}</p>
                <p className="text-xs" style={{ color: '#F09595' }}>No task assigned today</p>
              </div>
              <span className="text-xs self-center" style={{ color: '#555' }}>0 hrs</span>
            </div>
          ))}

          {crew.length === 0 && !fetching && (
            <div className="rounded-xl p-6 text-center" style={{ background: '#1e1e21', border: '0.5px solid #2a2a2a' }}>
              <p style={{ color: '#555' }}>No workers assigned to active jobs today.</p>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
