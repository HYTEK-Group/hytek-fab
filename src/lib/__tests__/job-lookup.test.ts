import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveAlias, resolveJobRef, resolveSharedJob } from '../job-lookup'

const JOB = {
  id: 'job-1',
  quote_number: '26050104',
  name: '79-83 Beacon St Morayfield Townhouses',
  client: 'AKAM Constructions',
  location: 'Morayfield',
  hubspot_deal_id: '271839486404',
  is_test: false,
}

/** jobs keyed by quote_number; job_aliases keyed by `key`. */
function fake(jobs: Record<string, unknown>, aliases: Record<string, string> = {}) {
  const reads: { table: string; col: string; val: unknown }[] = []
  const admin = {
    from(table: string) {
      return {
        select: () => ({
          eq: (col: string, val: unknown) => {
            reads.push({ table, col, val })
            const hit = table === 'jobs'
              ? (jobs[String(val)] ?? null)
              : (aliases[String(val)] ? { quote_number: aliases[String(val)] } : null)
            return {
              maybeSingle: () => Promise.resolve({ data: hit, error: null }),
              limit: () => ({ maybeSingle: () => Promise.resolve({ data: hit, error: null }) }),
            }
          },
        }),
      }
    },
  } as unknown as SupabaseClient
  return { admin, reads }
}

describe('resolveSharedJob', () => {
  it('returns the Hub row for a number the Hub knows', async () => {
    const { admin } = fake({ '26050104': JOB })
    expect(await resolveSharedJob(admin, '26050104')).toMatchObject({ quote_number: '26050104' })
  })

  it('trims, because a pasted number carries whitespace', async () => {
    const { admin } = fake({ '26050104': JOB })
    expect(await resolveSharedJob(admin, '  26050104 ')).not.toBeNull()
  })

  it('returns null for a TEST job — fab never fabricates one', async () => {
    const { admin } = fake({ '26079902': { ...JOB, quote_number: '26079902', is_test: true } })
    expect(await resolveSharedJob(admin, '26079902')).toBeNull()
  })

  it('returns null for a number the Hub has never issued', async () => {
    const { admin } = fake({})
    expect(await resolveSharedJob(admin, '99999999')).toBeNull()
  })
})

describe('resolveAlias', () => {
  it('maps a legacy reference to the canonical Hub number', async () => {
    const { admin } = fake({}, { HG260018: '2504074' })
    expect(await resolveAlias(admin, 'HG260018')).toBe('2504074')
  })

  it('returns null when nobody has recorded the alias', async () => {
    const { admin } = fake({}, {})
    expect(await resolveAlias(admin, 'HG999999')).toBeNull()
  })
})

describe('resolveJobRef', () => {
  it('matches the exact number without touching the alias table', async () => {
    const { admin, reads } = fake({ '26050104': JOB })
    const r = await resolveJobRef(admin, '26050104')
    expect(r).toMatchObject({ ok: true, matchedBy: 'quote' })
    expect(reads.some(x => x.table === 'job_aliases')).toBe(false)
  })

  it('resolves a legacy HG folder name to the 8-digit job it really is', async () => {
    const { admin } = fake({ '26050104': JOB }, { HG260044: '26050104' })
    const r = await resolveJobRef(admin, 'HG260044')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // The CANONICAL number, never the typed alias — this is what stops the same
    // job existing twice under two names.
    expect(r.job.quote_number).toBe('26050104')
    expect(r.matchedBy).toBe('alias')
  })

  it('refuses an unknown number, and says it is unknown', async () => {
    const { admin } = fake({}, {})
    expect(await resolveJobRef(admin, '99999999')).toEqual({ ok: false, reason: 'unknown' })
  })

  it('tells a TEST job apart from an unknown one — they need different answers', async () => {
    const { admin } = fake({ '26079902': { ...JOB, is_test: true } }, {})
    expect(await resolveJobRef(admin, '26079902')).toEqual({ ok: false, reason: 'test' })
  })

  it('refuses an alias that points at a job the Hub no longer has', async () => {
    const { admin } = fake({}, { HG260044: '26050104' })
    expect(await resolveJobRef(admin, 'HG260044')).toMatchObject({ ok: false })
  })
})
