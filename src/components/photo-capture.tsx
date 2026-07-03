'use client'

// Reusable proof-photo capture: a button that opens the camera (on a phone/tablet)
// or a file picker (on a PC), uploads to /api/fab/proof for the given stage + ids,
// and calls onDone. Photos are append-only — you can add more, never edit/delete.
import { useRef, useState } from 'react'
import type { ProofStage } from '@/lib/types'

export function PhotoCapture({
  jobId, token, stage, markId, packageId, loadId, treatmentType, label, onDone, variant = 'button',
}: {
  jobId: string; token: string; stage: ProofStage
  markId?: string; packageId?: string; loadId?: string; treatmentType?: string
  label: string; onDone?: () => void; variant?: 'button' | 'small'
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('stage', stage)
      fd.append('fab_job_id', jobId)
      if (markId) fd.append('fab_mark_id', markId)
      if (packageId) fd.append('fab_package_id', packageId)
      if (loadId) fd.append('fab_load_id', loadId)
      if (treatmentType) fd.append('treatment_type', treatmentType)
      const res = await fetch('/api/fab/proof', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
      if (!res.ok) { alert((await res.json().catch(() => ({}))).error ?? 'Photo upload failed'); return }
      onDone?.()
    } finally { setBusy(false) }
  }

  const small = variant === 'small'
  return (
    <label style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, cursor: busy ? 'default' : 'pointer',
      fontSize: small ? 12 : 14, fontWeight: 500,
      color: small ? 'var(--info)' : 'var(--on-brand)',
      background: small ? 'transparent' : 'var(--hytek-yellow)',
      border: small ? '0.5px solid var(--border)' : 'none',
      borderRadius: small ? 8 : 10, padding: small ? '6px 10px' : '10px 16px', opacity: busy ? 0.5 : 1,
    }}>
      {busy ? 'Uploading…' : `📷 ${label}`}
      <input ref={ref} type="file" accept="image/*" capture="environment" disabled={busy} onChange={onPick} style={{ display: 'none' }} />
    </label>
  )
}
