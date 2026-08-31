// GET /api/fab/pin/profiles — admin: the office LOGIN users a kiosk PIN can be
// linked to (for the gatekeeper four-eyes control). Names + roles only, no
// secrets. Used by the Workers page's "linked login" picker.
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getSupervisorCaller } from '@/lib/fab-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('profiles')
    .select('id, full_name, role')
    .order('full_name', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ profiles: (data ?? []).filter(p => p.full_name) })
}
