// POST /api/fab/sub/certs — attach a QA / weld / mill / coating / ITP cert to a
// granted package. Same evidence philosophy as proof photos: append-only,
// tamper-locked at the DB (fab_package_certs), stored in the private fab-proof
// bucket under a forced certs/ path. Required before drop-ship steel can be
// released to dispatch. Accepts images AND PDFs (certs are usually PDFs).
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getSubCaller, grantedPackage } from '@/lib/fab-sub-auth'
import { checkCert } from '@/lib/fab-cert-validity'
import type { CertKind } from '@/lib/types'

export const dynamic = 'force-dynamic'

const KINDS: CertKind[] = ['qa', 'weld', 'mill', 'coating', 'itp', 'other']
const MAX_BYTES = 15 * 1024 * 1024

export async function POST(req: NextRequest) {
  const caller = await getSubCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  const kind = String(form?.get('kind') ?? '') as CertKind
  const packageId = String(form?.get('fab_package_id') ?? '')
  if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 })
  if (!KINDS.includes(kind)) return NextResponse.json({ error: 'invalid kind' }, { status: 400 })
  if (!packageId) return NextResponse.json({ error: 'fab_package_id required' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'file too large (15 MB max)' }, { status: 400 })

  const pkg = grantedPackage(caller, packageId)
  if (!pkg) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const note = ((form?.get('note') as string) || '').slice(0, 500) || null

  const admin = getSupabaseAdmin()
  const buf = Buffer.from(await file.arrayBuffer())
  // Reject the obviously-wrong (blank / not a real doc) so a cert means something.
  const v = checkCert(buf)
  if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 400 })

  const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? '.pdf').toLowerCase()
  const path = `${pkg.fab_job_id}/certs/${packageId}/${randomUUID()}${ext}`
  const { error: upErr } = await admin.storage.from('fab-proof').upload(path, buf, {
    contentType: file.type || 'application/pdf', upsert: false,
  })
  if (upErr) return NextResponse.json({ error: 'upload failed: ' + upErr.message }, { status: 500 })

  const { data: row, error } = await admin.from('fab_package_certs').insert({
    fab_package_id: packageId,
    fab_job_id: pkg.fab_job_id, // derived from the grant
    kind,
    storage_path: path,
    file_name: file.name,
    note,
    uploaded_by: caller.stamp,
  }).select('id, kind, uploaded_at').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, id: row.id, kind: row.kind, uploaded_at: row.uploaded_at }, { status: 201 })
}
