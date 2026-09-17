// GET  /api/fab/jobs/[id]/drawings — lists PDFs in 'fab-drawings/{quote_number}/'.
// POST /api/fab/jobs/[id]/drawings — adds (or replaces) one shop drawing PDF there:
//   JSON {name, size}      → a signed upload URL the caller PUTs the PDF to (any size up to 50 MB)
//   multipart field `file` → uploaded here (4.5 MB and under only)
//
// The office-server ingest bridge (scripts/ss-ingest-bridge.mjs) sends every
// shop drawing through POST with its supervisor kiosk token. It used to write the
// bucket directly with a service-role key; when that key came off it (07/09)
// no POST handler was written, so every drawing got 405. This PR adds it; it
// works once deployed and once sql/migrations/016-fab-drawings-bucket-write.sql
// (which lets role app_fab write this bucket) is applied.

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

// Vercel refuses any function request body over 4.5 MB before this handler
// runs, and 54 of the 2,316 drawing PDFs on the drive are bigger (measured
// 17/09/2026; the combined ASSEMBLIES PDFs the matcher looks for first run to
// 26 MB). So large drawings never come through here as bytes: the caller sends
// JSON {name, size} and gets a signed upload URL to PUT the PDF to storage.
// Multipart stays for small files (the hytek-bridge fab-tekla-ingest plugin
// still posts that way), capped at Vercel's limit so every host answers alike.
const MAX_MULTIPART_BYTES = 4.5 * 1024 * 1024
// Supabase storage's default per-file limit. The biggest drawing today is 26 MB.
const MAX_DRAWING_BYTES = 50 * 1024 * 1024

function drawingName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  // Keep the base name only — the bridge sends the file's own name, and the
  // drawing matcher looks it up by that name — so it cannot leave the job folder.
  const name = (raw.split(/[\\/]/).pop() ?? '').trim()
  if (!name || name.startsWith('.') || !name.toLowerCase().endsWith('.pdf')) return null
  return name
}

const NOT_A_PDF_NAME = 'Only PDF shop drawings are accepted'

async function quoteNumberFor(id: string): Promise<string | null> {
  const { data: job, error } = await getSupabaseAdmin()
    .from('fab_jobs')
    .select('quote_number')
    .eq('id', id)
    .single()
  return error || !job ? null : job.quote_number
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Adding drawings is a supervisor job (the bridge mints a supervisor token),
  // the same wall as import-assembly and import-bom.
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const { id } = await params

  if ((req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return signedUpload(req, id)
  }

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file required (multipart form-data, or JSON {name, size} for a signed upload)' }, { status: 400 })
  }

  const name = drawingName(file.name)
  if (!name) return NextResponse.json({ error: NOT_A_PDF_NAME }, { status: 400 })
  if (file.size > MAX_MULTIPART_BYTES) {
    return NextResponse.json(
      { error: `${name} is over 4.5 MB, which Vercel will not accept as a request body — send JSON {name, size} for a signed upload URL instead` },
      { status: 413 },
    )
  }
  const bytes = Buffer.from(await file.arrayBuffer())
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return NextResponse.json({ error: `${name} is not a PDF` }, { status: 400 })
  }

  const quoteNumber = await quoteNumberFor(id)
  if (!quoteNumber) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const path = `${quoteNumber}/${name}`
  const { error } = await getSupabaseAdmin().storage
    .from('fab-drawings')
    .upload(path, bytes, { contentType: 'application/pdf', upsert: true })
  if (error) return NextResponse.json({ error: `Upload failed: ${error.message}` }, { status: 500 })

  return NextResponse.json({ ok: true, path })
}

// JSON {name, size} → a signed upload URL for fab-drawings/{job}/{name}, with
// upsert. The caller PUTs the PDF bytes to it and checks they start %PDF-
// first (scripts/lib/drawing-upload.mjs). The URL is minted as fab's own role,
// so migration 016's INSERT and UPDATE policies are what allow it.
async function signedUpload(req: NextRequest, id: string) {
  const body = (await req.json().catch(() => null)) as { name?: unknown; size?: unknown } | null
  const name = drawingName(body?.name)
  if (!name) return NextResponse.json({ error: NOT_A_PDF_NAME }, { status: 400 })
  const size = body?.size
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    return NextResponse.json({ error: 'size (bytes, a positive number) required' }, { status: 400 })
  }
  if (size > MAX_DRAWING_BYTES) {
    return NextResponse.json({ error: `Drawing is over ${MAX_DRAWING_BYTES / 1024 / 1024} MB` }, { status: 413 })
  }

  const quoteNumber = await quoteNumberFor(id)
  if (!quoteNumber) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const path = `${quoteNumber}/${name}`
  const { data, error } = await getSupabaseAdmin().storage
    .from('fab-drawings')
    .createSignedUploadUrl(path, { upsert: true })
  if (error || !data) {
    return NextResponse.json({ error: `Could not sign the upload: ${error?.message ?? 'no URL returned'}` }, { status: 500 })
  }
  return NextResponse.json({ ok: true, path, signedUrl: data.signedUrl, token: data.token })
}
