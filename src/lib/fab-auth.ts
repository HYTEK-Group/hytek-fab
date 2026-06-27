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
}

function bearer(request: NextRequest): string {
  return request.headers.get('authorization')?.replace('Bearer ', '').trim() ?? ''
}

/** Supervisor or admin, via kiosk token or Supabase. Null = not authorised. */
export async function getSupervisorCaller(request: NextRequest): Promise<CallerInfo | null> {
  const token = bearer(request)
  if (!token) return null

  const kiosk = verifyKioskToken(token)
  if (kiosk) {
    if (kiosk.role !== 'supervisor' && kiosk.role !== 'admin') return null
    return { role: kiosk.role, name: kiosk.worker_name }
  }

  const user = await requireFabSupervisor(request)
  if (!user) return null
  return { role: user.role, name: user.email ?? user.fullName ?? user.id }
}

/** Any authenticated caller (fabricator+), via kiosk token or Supabase. */
export async function getUserCaller(request: NextRequest): Promise<CallerInfo | null> {
  const token = bearer(request)
  if (!token) return null

  const kiosk = verifyKioskToken(token)
  if (kiosk) return { role: kiosk.role, name: kiosk.worker_name }

  const user = await requireFabUser(request)
  if (!user) return null
  return { role: user.role, name: user.email ?? user.fullName ?? user.id }
}
