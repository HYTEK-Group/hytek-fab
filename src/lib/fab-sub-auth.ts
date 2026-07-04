// Auth for the walled /api/fab/sub/* route tree. A subcontractor is NEVER a
// Supabase user, never a fab_pins worker, and never holds FAB_BRIDGE_TOKEN —
// only a sub token (fab-sub-token.ts). Every request re-expands the account's
// LIVE grants (fab_sub_grants where revoked_at is null, account is_active),
// so revocation is instant. Every sub route derives its working set from
// caller.packages — a client-supplied id that isn't in the grant set is a 404.
import { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { verifySubToken } from '@/lib/fab-sub-token'
import type { DeliveryMode, ContractorPackageStatus, PackageType, TreatmentType } from '@/lib/types'

export interface SubCallerPackage {
  package_id: string
  fab_job_id: string
  package_type: PackageType
  treatment_type: TreatmentType | null
  status: ContractorPackageStatus
  delivery_mode: DeliveryMode
  ready_at: string | null
  expected_return_date: string | null
  scope_note: string | null
}

export interface SubCaller {
  sub_account_id: string
  contractor_name: string
  /** Evidence-chain identity: how sub actions are stamped (taken_by / entered_by). */
  stamp: string
  packages: SubCallerPackage[]
}

function bearer(request: NextRequest): string {
  const h = request.headers.get('authorization') ?? ''
  return h.startsWith('Bearer ') ? h.slice(7).trim() : ''
}

/** The audit stamp for a sub action — distinct from any internal worker name. */
export function subStamp(contractor_name: string): string {
  return `SUB: ${contractor_name}`
}

export async function getSubCaller(request: NextRequest): Promise<SubCaller | null> {
  const session = verifySubToken(bearer(request))
  if (!session) return null

  const admin = getSupabaseAdmin()
  const { data: account } = await admin
    .from('fab_sub_accounts')
    .select('id, contractor_name, is_active')
    .eq('id', session.sub_account_id)
    .single()
  if (!account || !account.is_active) return null

  const { data: grants } = await admin
    .from('fab_sub_grants')
    .select(
      'package_id, revoked_at, fab_contractor_packages(id, fab_job_id, package_type, treatment_type, status, delivery_mode, ready_at, expected_return_date, scope_note)',
    )
    .eq('sub_account_id', account.id)
    .is('revoked_at', null)

  interface PkgRow {
    id: string
    fab_job_id: string
    package_type: PackageType
    treatment_type: TreatmentType | null
    status: ContractorPackageStatus
    delivery_mode: DeliveryMode
    ready_at: string | null
    expected_return_date: string | null
    scope_note: string | null
  }
  const packages: SubCallerPackage[] = []
  for (const g of grants ?? []) {
    // supabase-js types a many-to-one FK join as an array without generated
    // types; at runtime it is a single object. Normalise both shapes.
    const joined = (g as unknown as { fab_contractor_packages: PkgRow | PkgRow[] | null }).fab_contractor_packages
    const p = Array.isArray(joined) ? joined[0] : joined
    if (!p) continue
    packages.push({
      package_id: p.id,
      fab_job_id: p.fab_job_id,
      package_type: p.package_type,
      treatment_type: p.treatment_type,
      status: p.status,
      delivery_mode: p.delivery_mode,
      ready_at: p.ready_at,
      expected_return_date: p.expected_return_date,
      scope_note: p.scope_note,
    } satisfies SubCallerPackage)
  }

  return {
    sub_account_id: account.id,
    contractor_name: account.contractor_name,
    stamp: subStamp(account.contractor_name),
    packages,
  }
}

/** The granted package with this id, or null — the standard scoping check. */
export function grantedPackage(caller: SubCaller, packageId: string): SubCallerPackage | null {
  return caller.packages.find(p => p.package_id === packageId) ?? null
}
