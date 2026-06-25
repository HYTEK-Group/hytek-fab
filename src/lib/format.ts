// Australian formatting helpers — DD/MM/YYYY dates, AUD currency, metric.

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const dt = typeof d === 'string' ? new Date(d) : d
  if (isNaN(dt.getTime())) return '—'
  const dd = String(dt.getDate()).padStart(2, '0')
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${dt.getFullYear()}`
}

export function fmtAud(n: number | null | undefined): string {
  const v = typeof n === 'number' && isFinite(n) ? n : 0
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(v)
}

export function fmtTonnes(kg: number | null | undefined): string {
  const v = typeof kg === 'number' && isFinite(kg) ? kg : 0
  return `${(v / 1000).toFixed(2)} t`
}
