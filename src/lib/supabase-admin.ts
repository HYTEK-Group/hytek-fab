// Server-only. Bypasses RLS — NEVER import into 'use client' modules.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null = null

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL missing')
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing (server only)')
  cached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  return cached
}

export function __resetSupabaseAdminForTests() {
  cached = null
}
