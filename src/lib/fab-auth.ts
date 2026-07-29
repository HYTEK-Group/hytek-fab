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

// A kiosk caller is identified by their PIN's worker_name (the only stable handle
// the token carries); a Supabase caller by their profile uuid, displayed by name.
function kioskCaller(worker_name: string, role: UserRole): CallerInfo {
  return { role, name: worker_name, ns: 'kiosk', key: `pin:${worker_name}` }
}
function supabaseCaller(user: { id: string; role: UserRole; fullName: string | null; email: string | null }): CallerInfo {
  return { role: user.role, name: user.fullName ?? user.email ?? user.id, ns: 'supabase', key: `sb:${user.id}` }
}

/** Supervisor or admin, via kiosk token or Supabase. Null = not authorised. */
export async function getSupervisorCaller(request: NextRequest): Promise<CallerInfo | null> {
  const token = bearer(request)
  if (!token) return null

  const kiosk = verifyKioskToken(token)
  if (kiosk) {
    if (kiosk.role !== 'supervisor' && kiosk.role !== 'admin') return null
    return kioskCaller(kiosk.worker_name, kiosk.role)
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
