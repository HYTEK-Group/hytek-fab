// GET  /api/fab/jobs/[id]/drawings — lists PDFs in 'fab-drawings/{quote_number}/'.
// POST /api/fab/jobs/[id]/drawings — adds (or replaces) one shop drawing PDF there.
//
// The office-server ingest bridge (scripts/ss-ingest-bridge.mjs) posts every
// shop drawing to POST with its supervisor kiosk token. It used to write the
// bucket directly with a service-role key; when that key came off it (07/09)
// this handler was never written, so every drawing got 405 until 17/09/2026.
// fab now writes this bucket itself, as role app_fab
// (sql/migrations/016-fab-drawings-bucket-write.sql).

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
// getUserCaller accepts a kiosk token as well as a Supabase JWT — the
// office-server ingest bridge uploads shop drawings through this route now
// instead of writing the storage bucket with a service-role key.
import { getSupervisorCaller, getUserCaller } from '@/lib/fab-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserCaller(req)
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

// Above Vercel's request-body limit anyway (4.5 MB on a function), so in
// production a bigger file never reaches here; the cap is for any other host.
const MAX_DRAWING_BYTES = 20 * 1024 * 1024

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Adding drawings is a supervisor job (the bridge mints a supervisor token),
  // the same wall as import-assembly and import-bom.
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const { id } = await params

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file required (multipart form-data)' }, { status: 400 })
  }

  // Keep the base name only — the bridge sends the file's own name, and the
  // drawing matcher looks it up by that name — so it cannot leave the job folder.
  const name = (file.name.split(/[\\/]/).pop() ?? '').trim()
  if (!name || name.startsWith('.') || !name.toLowerCase().endsWith('.pdf')) {
    return NextResponse.json({ error: 'Only PDF shop drawings are accepted' }, { status: 400 })
  }
  if (file.size > MAX_DRAWING_BYTES) {
    return NextResponse.json({ error: `Drawing is over ${MAX_DRAWING_BYTES / 1024 / 1024} MB` }, { status: 413 })
  }
  const bytes = Buffer.from(await file.arrayBuffer())
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return NextResponse.json({ error: `${name} is not a PDF` }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const { data: job, error: jobErr } = await admin
    .from('fab_jobs')
    .select('quote_number')
    .eq('id', id)
    .single()
  if (jobErr || !job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const path = `${job.quote_number}/${name}`
  const { error } = await admin.storage
    .from('fab-drawings')
    .upload(path, bytes, { contentType: 'application/pdf', upsert: true })
  if (error) return NextResponse.json({ error: `Upload failed: ${error.message}` }, { status: 500 })

  return NextResponse.json({ ok: true, path })
}
