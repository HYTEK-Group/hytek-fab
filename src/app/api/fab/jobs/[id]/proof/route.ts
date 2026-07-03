// GET /api/fab/jobs/[id]/proof — the job's proof pack (made → coating → bundled →
// loaded), signed URLs, for the in-app proof view + the "N of Y photographed" gauge.
import { NextRequest, NextResponse } from 'next/server'
import { getUserCaller } from '@/lib/fab-auth'
import { loadProofPack } from '@/lib/fab-proof-server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getUserCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const res = await loadProofPack(id)
  if (!res) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  return NextResponse.json(res)
}
