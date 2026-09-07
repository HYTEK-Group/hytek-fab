// Server-only. Does the Hub know this job number, and what is its real one?
//
// THE FAULT THIS CLOSES. `POST /api/fab/jobs` inserted a `fab_jobs` row from
// whatever `quote_number` the body carried, with no check against anything. The
// Tekla ingest bridge was worse: when a Y: folder was not named `HG######` it
// used THE WHOLE FOLDER NAME as the job number, so a directory called
// "26070101 - Smith Road" minted a fab job numbered `26070101 - Smith Road`.
// Only the Hub issues job numbers (CLAUDE.md rule 1). fab starting fabrication
// on a number nobody issued is a job that exists in exactly one database and
// reconciles with nothing.
//
// WHY THIS READS `job_aliases` DIRECTLY rather than calling the Hub.
// LANES/07-fab.md §3.4 specifies `GET {HUB}/api/jobs/resolve?ref=` — a route
// Lane 3 has not built (it is item (e) of that lane's hand-off list). fab
// already reads SHARED `jobs` for identity through its own client; `job_aliases`
// is the same database, the same client and the same kind of read, so resolving
// here needs no cross-lane dependency and no new host. If Lane 3 ships the route
// later it is a nicety, not a prerequisite — and this way the guard is on today
// instead of waiting behind another lane.
//
// `job_aliases` shape, measured on production 07/09/2026:
//   (id, job_id, quote_number, system, key, confirmed_how, confirmed_by, …)
//   `key` is the number as some other system knows it; `quote_number` is the
//   canonical Hub number. 410 rows across systems invoicing / planner / lws /
//   hub-legacy / hub-legacy-7digit / billing-book / drive.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface SharedJob {
  id: string
  quote_number: string
  name: string | null
  client: string | null
  location: string | null
  hubspot_deal_id: string | null
  is_test: boolean
}

const COLUMNS = 'id, quote_number, name, client, location, hubspot_deal_id, is_test'

/**
 * The Hub's row for this exact number, or null.
 *
 * A TEST job resolves to null on purpose: fab never fabricates one, which is the
 * same rule the ready queue already applies. It is not an error — there is
 * simply nothing to make.
 */
export async function resolveSharedJob(
  admin: SupabaseClient,
  quoteNumber: string,
): Promise<SharedJob | null> {
  const q = quoteNumber.trim()
  if (!q) return null
  const { data } = await admin.from('jobs').select(COLUMNS).eq('quote_number', q).maybeSingle()
  if (!data) return null
  const job = data as unknown as SharedJob
  return job.is_test ? null : job
}

/** The canonical Hub number for a legacy reference (`HG260018`, a 7-digit
 *  `2504074`, an invoicing or planner key), or null if nobody has recorded it. */
export async function resolveAlias(admin: SupabaseClient, ref: string): Promise<string | null> {
  const r = ref.trim()
  if (!r) return null
  const { data } = await admin
    .from('job_aliases')
    .select('quote_number')
    .eq('key', r)
    .limit(1)
    .maybeSingle()
  return (data as { quote_number?: string } | null)?.quote_number ?? null
}

export type ResolveOutcome =
  | { ok: true; job: SharedJob; matchedBy: 'quote' | 'alias' }
  | { ok: false; reason: 'unknown' | 'test' }

/**
 * The one entry point. Exact number first, then the alias table.
 *
 * The distinction between 'unknown' and 'test' matters at the call site: an
 * unknown number is a data question for the Monday review, a test job is a
 * deliberate exclusion, and telling a supervisor the wrong one wastes their
 * afternoon.
 */
export async function resolveJobRef(admin: SupabaseClient, ref: string): Promise<ResolveOutcome> {
  const direct = await resolveSharedJob(admin, ref)
  if (direct) return { ok: true, job: direct, matchedBy: 'quote' }

  const alias = await resolveAlias(admin, ref)
  if (alias) {
    const viaAlias = await resolveSharedJob(admin, alias)
    if (viaAlias) return { ok: true, job: viaAlias, matchedBy: 'alias' }
  }

  // Separate the two "no" answers. A row that exists but is_test came back null
  // from resolveSharedJob, so ask once more without the filter to say which.
  const { data: testRow } = await admin
    .from('jobs')
    .select('is_test')
    .eq('quote_number', ref.trim())
    .maybeSingle()
  return { ok: false, reason: (testRow as { is_test?: boolean } | null)?.is_test ? 'test' : 'unknown' }
}
