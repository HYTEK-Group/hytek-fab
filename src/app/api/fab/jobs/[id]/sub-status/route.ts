// GET /api/fab/jobs/[id]/sub-status — the office's live view of subcontracted
// work on one job: each fabrication package with its granted sub logins, the
// photo-proven made count, cert list (signed URLs), readiness, and — for
// drop-ship — the release verdict from the ONE gate (canReleaseDropShip), so
// the UI checklist and the release button can never disagree with the API.
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getUserCaller } from '@/lib/fab-auth'
import { canReleaseDropShip } from '@/lib/fab-sub-release'
import type { CcLevel, ComplianceMode, DeliveryMode } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getUserCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const admin = getSupabaseAdmin()
  const { data: job } = await admin
    .from('fab_jobs')
    .select('id, quote_number, cc_level, compliance_mode')
    .eq('id', id).single()
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const { data: pkgs } = await admin
    .from('fab_contractor_packages')
    .select('id, package_type, treatment_type, contractor_name, contractor_contact, scope_note, status, delivery_mode, ready_at, drop_ship_released_at, drop_ship_released_by, sent_at, expected_return_date, returned_at')
    .eq('fab_job_id', id)
    .order('created_at', { ascending: true })

  const packages = []
  for (const pkg of pkgs ?? []) {
    const [{ data: marks }, { data: photos }, { data: certs }, { data: grants }] = await Promise.all([
      admin.from('fab_marks').select('id').eq('contractor_package_id', pkg.id),
      admin.from('fab_proof_photos').select('fab_mark_id, stage').eq('fab_package_id', pkg.id),
      admin.from('fab_package_certs')
        .select('id, kind, storage_path, file_name, note, uploaded_by, uploaded_at')
        .eq('fab_package_id', pkg.id).order('uploaded_at', { ascending: true }),
      admin.from('fab_sub_grants')
        .select('revoked_at, fab_sub_accounts(id, contractor_name, login_slug, is_active, pin_hash)')
        .eq('package_id', pkg.id),
    ])

    // Count made photos of marks CURRENTLY in the package (ignore orphans from
    // removed marks) — this feeds the drop-ship release verdict, so it must be exact.
    const currentIds = new Set((marks ?? []).map(m => m.id))
    const madeMarks = new Set(
      (photos ?? [])
        .filter(p => p.stage === 'made' && p.fab_mark_id && currentIds.has(p.fab_mark_id))
        .map(p => p.fab_mark_id as string),
    )
    const totalMarks = marks?.length ?? 0

    // Sign cert URLs in one batch.
    const certPaths = (certs ?? []).map(c => c.storage_path)
    const signed = certPaths.length > 0
      ? (await admin.storage.from('fab-proof').createSignedUrls(certPaths, 3600)).data ?? []
      : []
    const urlByPath = new Map(signed.map(s => [s.path, s.signedUrl]))

    const verdict = canReleaseDropShip({
      package_type: pkg.package_type,
      delivery_mode: pkg.delivery_mode as DeliveryMode,
      drop_ship_released_at: pkg.drop_ship_released_at,
      ready_at: pkg.ready_at,
      total_marks: totalMarks,
      marks_with_made_photo: madeMarks.size,
      cert_count: certs?.length ?? 0,
      cc_level: job.cc_level as CcLevel | null,
      compliance_mode: job.compliance_mode as ComplianceMode,
    })

    packages.push({
      ...pkg,
      total_marks: totalMarks,
      marks_with_made_photo: madeMarks.size,
      certs: (certs ?? []).map(c => ({
        id: c.id, kind: c.kind, file_name: c.file_name, note: c.note,
        uploaded_by: c.uploaded_by, uploaded_at: c.uploaded_at,
        url: urlByPath.get(c.storage_path) ?? null,
      })),
      sub_logins: (grants ?? []).map(g => {
        interface AccountRow {
          id: string; contractor_name: string; login_slug: string
          is_active: boolean; pin_hash: string | null
        }
        // supabase-js types a many-to-one FK join as an array without generated
        // types; at runtime it is a single object. Normalise both shapes.
        const a = g as unknown as { revoked_at: string | null; fab_sub_accounts: AccountRow | AccountRow[] | null }
        const acc = Array.isArray(a.fab_sub_accounts) ? a.fab_sub_accounts[0] : a.fab_sub_accounts
        return acc ? {
          sub_account_id: acc.id,
          contractor_name: acc.contractor_name,
          is_active: acc.is_active,
          pin_set: acc.pin_hash != null,
          revoked: a.revoked_at != null,
        } : null
      }).filter(Boolean),
      drop_ship: pkg.delivery_mode === 'drop_ship'
        ? { can_release: verdict.ok, blockers: verdict.blockers }
        : null,
    })
  }

  return NextResponse.json({ quote_number: job.quote_number, packages })
}
