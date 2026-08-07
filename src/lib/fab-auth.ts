// Dual auth: API routes that supervisors hit from BOTH the PC (Supabase
// Bearer) and the kiosk tablet (HMAC kiosk token). Tries the cheap sync
// kiosk check first, falls back to Supabase.
import type { NextRequest } from 'next/server'
import { requireFabSupervisor, requireFabUser } from './get-fab-user'
import { verifyKioskToken } from './fab-kiosk-token'
import type { UserRole } from './types'

export interface CallerInfo {
  role: UserRole
  name: string
  /** Which identity namespace this caller authenticated in. */
  ns: 'kiosk' | 'supabase'
  /** Stable-within-namespace id: `sb:<uuid>` (login) or `pin:<worker_name>` (kiosk).
   *  Used by the gatekeeper four-eyes check — see fab-gatekeeper.sameHuman. */
  key: string
}

function bearer(request: NextRequest): string {
  return request.headers.get('authorization')?.replace('Bearer ', '').trim() ?? ''
}

// A kiosk caller is identified by their PIN's worker_name — UNLESS the PIN is
// linked to a login (profile_id), in which case they get the SAME key as that
// login (`sb:<uuid>`) so the gatekeeper treats their kiosk and PC actions as one
// person. ns stays 'kiosk' (that's how they authenticated — clearing is still
// login-only regardless).
// Exported (not just used here) so the identity-composition logic itself is
// unit-testable against fab-gatekeeper's sameHuman/canClearException — see
// fab-auth.test.ts.
export function kioskCaller(worker_name: string, role: UserRole, profile_id?: string | null): CallerInfo {
  return { role, name: worker_name, ns: 'kiosk', key: profile_id ? `sb:${profile_id}` : `pin:${worker_name}` }
}
export function supabaseCaller(user: { id: string; role: UserRole; fullName: string | null; email: string | null }): CallerInfo {
  return { role: user.role, name: user.fullName ?? user.email ?? user.id, ns: 'supabase', key: `sb:${user.id}` }
}

/** Supervisor or admin, via kiosk token or Supabase. Null = not authorised. */
export async function getSupervisorCaller(request: NextRequest): Promise<CallerInfo | null> {
  const token = bearer(request)
  if (!token) return null

  const kiosk = verifyKioskToken(token)
  if (kiosk) {
    if (kiosk.role !== 'supervisor' && kiosk.role !== 'admin') return null
    return kioskCaller(kiosk.worker_name, kiosk.role, kiosk.profile_id)
  }

  const user = await requireFabSupervisor(request)
  if (!user) return null
  return supabaseCaller(user)
}

/** Any authenticated caller (fabricator+), via kiosk token or Supabase. */
export async function getUserCaller(request: NextRequest): Promise<CallerInfo | null> {
  const token = bearer(request)
  if (!token) return null

  const kiosk = verifyKioskToken(token)
  if (kiosk) return kioskCaller(kiosk.worker_name, kiosk.role)

  const user = await requireFabUser(request)
  if (!user) return null
  return supabaseCaller(user)
}
