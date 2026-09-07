// Server-only. fab's ONE database client. NEVER import into a 'use client' module.
//
// WHAT CHANGES HERE, AND WHY IT IS THE WHOLE POINT OF LANE 13.
//
// This file used to build its client from `SUPABASE_SERVICE_ROLE_KEY` — the
// project's master key. A service-role key does not have permissions; it has NO
// permissions checks. It reads and writes every table in SHARED: the mint's
// `jobs`, the Hub's `flow_*`, detailing's `tasks`, dispatch's manifests,
// invoicing's triggers, `profiles` including the password column that was
// readable in plain text until 06/09. A bug in a fab route, or anything that can
// reach one, has the run of the operations database.
//
// The passport says fab owns twenty-one `fab_*` tables plus `job_bom`, and reads
// `jobs`, `job_aliases` and `profiles`. `SUPABASE_ROLE_KEY` is a token for the
// Postgres role `app_fab`, which Lane 13 mints with EXACTLY those grants. Every
// query in this app then runs under a role that cannot do what fab does not do —
// and the passport stops being a document that describes the app and becomes the
// thing that constrains it. A re-added `flow_fab_progress` write does not just
// fail `npm run test:architecture`; it gets 42501 from Postgres.
//
// HOW THE TWO HEADERS WORK. `apikey` is the project's gateway credential — it
// says which Supabase project you are talking to, and the ANON key is the right
// one for that; it grants nothing on its own. `Authorization: Bearer <role JWT>`
// is what PostgREST reads the `role` claim from, so the connection runs as
// `app_fab`. The anon key alone would be anon; the role key alone would not be
// accepted by the gateway. Both, or neither.
//
// THE FALLBACK IS TEMPORARY AND SAYS SO OUT LOUD.
// Until Lane 13 CP1 mints `app_fab` and puts `SUPABASE_ROLE_KEY` in Vercel,
// there is nothing to use, so this falls back to the service key and warns on
// every cold start. The warning is not decoration: a fallback nobody can see is
// a fallback that becomes permanent. Lane 13 deletes the fallback, this comment
// and `SUPABASE_SERVICE_ROLE_KEY` from the passport together.
// OWNER: Lane 13. DATE: by 30/11/2026.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null = null

/** Which credential the live client was built from. Read by the health route
 *  and by the test below — "are we on the role key yet?" must be answerable
 *  without reading a deploy log. */
export type AdminKeyMode = 'role' | 'service-role'
let mode: AdminKeyMode | null = null

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL missing')

  const roleKey = (process.env.SUPABASE_ROLE_KEY ?? '').trim()
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()

  if (roleKey && anonKey) {
    mode = 'role'
    cached = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${roleKey}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    return cached
  }

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  if (!serviceKey) {
    throw new Error(
      'no server database credential: set SUPABASE_ROLE_KEY (with NEXT_PUBLIC_SUPABASE_ANON_KEY) for role app_fab, or SUPABASE_SERVICE_ROLE_KEY until Lane 13 mints it',
    )
  }
  console.warn(
    roleKey
      ? '[fab] SUPABASE_ROLE_KEY is set but NEXT_PUBLIC_SUPABASE_ANON_KEY is not — falling back to the SERVICE-ROLE key, which bypasses every grant. Set the anon key (Lane 13).'
      : '[fab] running on the SERVICE-ROLE key, which bypasses every grant in SYSTEM.md. Set SUPABASE_ROLE_KEY for role app_fab (Lane 13).',
  )
  mode = 'service-role'
  cached = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  return cached
}

/** 'role' once fab is on app_fab; 'service-role' while the fallback is live.
 *  Null before the first getSupabaseAdmin() call. */
export function supabaseAdminKeyMode(): AdminKeyMode | null {
  return mode
}

export function __resetSupabaseAdminForTests() {
  cached = null
  mode = null
}
