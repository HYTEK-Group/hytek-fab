// GET /api/fab/jobs/[id]/drawings
// Lists PDFs from Supabase Storage bucket 'fab-drawings/{quote_number}/'.
// The Y: drive sync server uploads here; fab app reads, never writes.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { requireFabUser } from '@/lib/get-fab-user'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireFabUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const admin = getSupabaseAdmin()

  // Resolve quote_number from fab_job id
  const { data: job, error: jobErr } = await admin
    .from('fab_jobs')
    .select('quote_number')
    .eq('id', id)
    .single()
  if (jobErr || !job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const prefix = `${job.quote_number}/`
  const { data: files, error } = await admin.storage
    .from('fab-drawings')
    .list(prefix, { limit: 200, sortBy: { column: 'name', order: 'asc' } })

  if (error) {
    // Bucket may not exist yet (schema not applied / no drawings uploaded)
    return NextResponse.json({ drawings: [], note: error.message })
  }

  // Generate signed URLs (60 min) for each PDF
  const drawings = await Promise.all(
    (files ?? [])
      .filter(f => f.name.toLowerCase().endsWith('.pdf'))
      .map(async f => {
        const path = `${prefix}${f.name}`
        const { data: signed } = await admin.storage
          .from('fab-drawings')
          .createSignedUrl(path, 3600)
        return {
          name: f.name,
          path,
          url: signed?.signedUrl ?? null,
          size: f.metadata?.size ?? null,
          updated_at: f.updated_at ?? null,
        }
      })
  )

  return NextResponse.json({ drawings, quote_number: job.quote_number })
}
