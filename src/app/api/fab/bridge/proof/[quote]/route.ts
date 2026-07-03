// GET /api/fab/bridge/proof/[quote] — token-guarded proof pack for a job, for the
// dispatch/driver app (Troy) to show beside its own delivery photos. Same
// FAB_BRIDGE_TOKEN as the dispatch feed. Read-only; returns signed photo URLs.
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { loadProofPack } from '@/lib/fab-proof-server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ quote: string }> }) {
  const token = process.env.FAB_BRIDGE_TOKEN
  if (!token) return NextResponse.json({ configured: false, reason: 'FAB_BRIDGE_TOKEN not set' })
  const auth = req.headers.get('authorization') ?? ''
  if ((auth.startsWith('Bearer ') ? auth.slice(7) : '') !== token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { quote } = await params

  const admin = getSupabaseAdmin()
  const { data: job } = await admin.from('fab_jobs').select('id').eq('quote_number', decodeURIComponent(quote)).single()
  if (!job) return NextResponse.json({ configured: true, found: false, error: 'Job not in fab' }, { status: 404 })

  const res = await loadProofPack(job.id as string)
  if (!res) return NextResponse.json({ configured: true, found: false }, { status: 404 })
  return NextResponse.json({ configured: true, found: true, ...res })
}
