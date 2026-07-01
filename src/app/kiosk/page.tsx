'use client'

// Public PIN entry. No Supabase auth. Stores kiosk session in sessionStorage.
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const YELLOW = 'var(--hytek-yellow)'

export default function KioskPinPage() {
  const router = useRouter()
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function clear() { setPin(''); setError('') }

  async function submit(value: string) {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/fab/pin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: value }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'PIN not recognised')
        setPin('')
        return
      }
      sessionStorage.setItem('fab_kiosk', JSON.stringify({
        worker_name: json.worker_name,
        role: json.role,
        token: json.token,
        signed_in_at: Date.now(),
      }))
      router.push(json.role === 'supervisor' || json.role === 'admin'
        ? '/kiosk/supervisor' : '/kiosk/work')
    } finally {
      setBusy(false)
    }
  }

  function onDigit(d: string) {
    setError('')
    const next = pin.length < 4 ? pin + d : pin
    setPin(next)
    if (next.length === 4) submit(next)
  }

  return (
    <main style={{
      minHeight: '100vh', background: 'var(--background)', color: 'var(--foreground)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <h1 style={{ color: 'var(--foreground)', fontWeight: 700, marginBottom: 8 }}>HYTEK Fab</h1>
      <p style={{ opacity: 0.7, marginBottom: 24 }}>Enter your PIN</p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{
            width: 24, height: 24, borderRadius: '50%',
            background: i < pin.length ? YELLOW : 'transparent',
            border: `2px solid ${YELLOW}`,
          }} />
        ))}
      </div>
      {error && <p style={{ color: 'var(--danger)', marginBottom: 16 }}>{error}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 80px)', gap: 12 }}>
        {['1','2','3','4','5','6','7','8','9'].map(d => (
          <button key={d} disabled={busy} onClick={() => onDigit(d)} style={keyStyle}>{d}</button>
        ))}
        <button onClick={clear} style={{ ...keyStyle, fontSize: 16 }}>Clear</button>
        <button disabled={busy} onClick={() => onDigit('0')} style={keyStyle}>0</button>
        <span />
      </div>
    </main>
  )
}

const keyStyle: React.CSSProperties = {
  width: 80, height: 80, fontSize: 28, borderRadius: 12,
  border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', cursor: 'pointer',
}
