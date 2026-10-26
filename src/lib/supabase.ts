import { createClient } from '@supabase/supabase-js'
import { sharedLoginClientOptions } from './shared-login'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

if (!supabaseUrl || !supabaseAnonKey) console.error('Missing Supabase env vars')

// On hytekframing.com.au with the shared-login switch on, the login is kept in
// the cookie the other apps read too (lib/shared-login.ts, D232).
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder',
  sharedLoginClientOptions()
)
