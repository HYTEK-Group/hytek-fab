// Server-only. Calls Hub's job-state endpoint.
// Hub is the single source of truth for ss_drawings_issued + materials_received.
// We NEVER read detailing_handoffs or purchasing tables directly.

import type { HubJobState } from './types'

const HUB_BASE = (process.env.HUB_BASE ?? 'https://hub.hytekframing.com.au').replace(/\/$/, '')
const HUB_TOKEN = process.env.HUB_INTERNAL_TOKEN ?? ''

export type JobStateResult =
  | { ok: true; state: HubJobState }
  | { ok: false; status: number; error: string }

export async function getJobState(dealId: string): Promise<{ ok: true; state: HubJobState } | { ok: false; status: number; error: string }> {
  if (!HUB_TOKEN) {
    // Token not set (local dev / Purchasing not yet wired) — return permissive defaults
    // so the ready queue shows jobs with a "Hub unreachable — permissive mode" warning
    // rather than crashing or blocking all work.
    return {
      ok: true,
      state: {
        ok: true,
        deal_id: dealId,
        quote_number: null,
        state: 'unknown',
        tier: null,
        ready_to_ship: false,
        ss_release: null,
        lws_release: null,
        materials_received: false,
        missing: ['HUB_INTERNAL_TOKEN not set'],
        delivered: false,
        on_site_date: null,
        locked: false,
      },
    }
  }

  try {
    const res = await fetch(`${HUB_BASE}/api/flow/job-state/${encodeURIComponent(dealId)}`, {
      headers: { Authorization: `Bearer ${HUB_TOKEN}` },
      next: { revalidate: 30 },
    })
    if (!res.ok) {
      return { ok: false, status: res.status, error: `Hub returned ${res.status}` }
    }
    const data = (await res.json()) as HubJobState
    return { ok: true, state: data }
  } catch (err) {
    return { ok: false, status: 503, error: String(err) }
  }
}

export async function getJobStateByQuoteNumber(quoteNumber: string): Promise<{ ok: true; state: HubJobState } | { ok: false; status: number; error: string }> {
  if (!HUB_TOKEN) {
    return {
      ok: true,
      state: {
        ok: true,
        deal_id: null,
        quote_number: quoteNumber,
        state: 'unknown',
        tier: null,
        ready_to_ship: false,
        ss_release: null,
        lws_release: null,
        materials_received: false,
        missing: ['HUB_INTERNAL_TOKEN not set'],
        delivered: false,
        on_site_date: null,
        locked: false,
      },
    }
  }

  try {
    const url = `${HUB_BASE}/api/flow/job-state/_?quote_number=${encodeURIComponent(quoteNumber)}`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${HUB_TOKEN}` },
      next: { revalidate: 30 },
    })
    if (!res.ok) return { ok: false, status: res.status, error: `Hub returned ${res.status}` }
    const data = (await res.json()) as HubJobState
    return { ok: true, state: data }
  } catch (err) {
    return { ok: false, status: 503, error: String(err) }
  }
}
