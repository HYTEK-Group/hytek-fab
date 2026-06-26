// Server-only: verify caller is a signed-in fab user (row in profiles on gqtikz).
// Same pattern as hytek-install's get-office-user.ts.

import { getSupabaseAdmin } from './supabase-admin'
import type { UserRole } from './types'

export interface FabUser {
  id: string
  role: UserRole
  fullName: string | null
  email: string | null
}

function bearer(request: Request): string | null {
  const h = request.headers.get('authorization') || ''
  return h.startsWith('Bearer ') ? h.slice(7).trim() || null : null
}

export async function getFabUser(request: Request): Promise<FabUser | null> {
  const token = bearer(request)
  if (!token) return null
  const sb = getSupabaseAdmin()
  const { data: auth, error } = await sb.auth.getUser(token)
  if (error || !auth?.user) return null
  const { data: profile } = await sb
    .from('profiles')
    .select('id, role, full_name, active')
    .eq('id', auth.user.id)
    .maybeSingle()
  if (!profile || profile.active === false) return null
  return {
    id: profile.id,
    role: (profile.role ?? 'fabricator') as UserRole,
    fullName: profile.full_name ?? null,
    email: auth.user.email ?? null,
  }
}

export async function requireFabUser(request: Request): Promise<FabUser | null> {
  return getFabUser(request)
}

export async function requireFabSupervisor(request: Request): Promise<FabUser | null> {
  const user = await getFabUser(request)
  if (!user) return null
  if (user.role !== 'admin' && user.role !== 'supervisor') return null
  return user
}
