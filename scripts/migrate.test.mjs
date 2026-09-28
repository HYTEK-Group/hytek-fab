// Tests for the migration runner — canonical copy.
// Every app repo carries a byte-identical copy at scripts/migrate.test.mjs.
//
// The runner is driven here with a fake Management API and a fake process, so
// every refusal and every drift kind is proved without touching a database and
// without the runner carrying an environment variable that could redirect the
// real thing at another host.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  main, sha, quote, readPassport, resolveTarget, discoverIn, diffObjects,
  classify, transactional, PROD_REFS, SHARED_REFS, ExitSignal, LEDGER_DDL, isUntransactioned,
  FINGERPRINT_SQL,
} from './migrate.mjs'

const STG = 'lvjxqygftugmcadstpff'
const PROD = 'gqtikzguvhukpujyxkez'

const PASSPORT = `---
app: test-repo
migrations_dir: sql/migrations
migrate_staging: ${STG}
migrate_prod: ${PROD}
tables:
  owns:
    - jobs
---

body
`

let root
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'))
  fs.writeFileSync(path.join(root, 'SYSTEM.md'), PASSPORT)
  fs.mkdirSync(path.join(root, 'sql', 'migrations'), { recursive: true })
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

const write = (name, body) => fs.writeFileSync(path.join(root, 'sql', 'migrations', name), body)

/** The runner stores a HASH of each object definition, so a seeded fingerprint
 *  has to be hashed the same way or every comparison is drift. */
const hashed = (objects) => Object.fromEntries(Object.entries(objects)
  .map(([k, def]) => [k, crypto.createHash('sha256').update(String(def)).digest('hex').slice(0, 16)]))
const seedFp = (objects) => ({ id: 1, taken_at: '2026-09-07T00:00:00Z', taken_by: 'lane2', digest: 'x', objects: hashed(objects), reason: 'accept' })

/** A fake Management API. `state` is the database: a ledger, a fingerprint
 *  history, a lock and a list of every statement it was asked to run. */
function fakeApi({ ledger = [], fingerprints = [], lockHolder = null, lockRow = true, objects = {}, preLane2 = null } = {}) {
  const state = { ledger, fingerprints, lockHolder, lockRow, objects, preLane2, sql: [], urls: [] }
  const reply = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  state.fetch = async (url, init) => {
    const q = JSON.parse(init.body).query
    state.sql.push(q)
    state.urls.push(String(url))
    const l = q.toLowerCase()

    if (l.includes("to_regclass('public.schema_migrations')")) return reply([{ ok: true }])
    // the carried-over ledger: absent unless the test says otherwise
    if (l.includes("to_regclass('public.schema_migrations_pre_lane2')")) return reply([{ ok: state.preLane2 !== null }])
    if (l.includes('from public.schema_migrations_pre_lane2')) return reply((state.preLane2 ?? []).map((id) => ({ id })))
    if (l.includes('create table if not exists public.schema_migrations')) return reply([])
    if (l.startsWith('select name, checksum, applied_at')) return reply(state.ledger)
    if (l.includes('from public.schema_fingerprint order by id desc')) {
      return reply(state.fingerprints.length ? [state.fingerprints[state.fingerprints.length - 1]] : [])
    }
    if (l.includes("select 'column' as class")) {
      return reply(Object.entries(state.objects).map(([k, def]) => {
        const [cls, ...rest] = k.split('|')
        return { class: cls, key: rest.join('|'), def }
      }))
    }
    if (l.includes('insert into public.schema_fingerprint')) {
      const digest = /values \('([0-9a-f]{64})'/.exec(q)?.[1] ?? 'x'
      state.fingerprints.push({ id: state.fingerprints.length + 1, taken_at: new Date().toISOString(), taken_by: 'test', digest, objects: hashed(state.objects), reason: 'test' })
      return reply([])
    }
    if (l.includes('update public.coordination_lock') && l.includes('holder is null')) {
      if (state.lockHolder) return reply([])
      state.lockHolder = /holder = '([^']*)'/.exec(q)?.[1] ?? 'someone'
      return reply([{ holder: state.lockHolder }])
    }
    if (l.includes('update public.coordination_lock') && l.includes("holder = null")) { state.lockHolder = null; return reply([]) }
    if (l.includes('from public.coordination_lock')) {
      return reply(state.lockRow ? [{ holder: state.lockHolder, note: 'busy', claimed_at: new Date().toISOString() }] : [])
    }
    if (l.includes('insert into public.schema_migrations')) {
      const m = /values \('[^']*', '([^']*)', '([0-9a-f]{64})'/.exec(q)
      if (m) state.ledger.push({ name: m[1], checksum: m[2], applied_at: new Date().toISOString(), applied_by: 'test', source: 'runner', note: null })
      return reply([])
    }
    return reply([])
  }
  return state
}

/** Run the CLI against a fake API. Returns everything it said and did. */
async function run(argv, { api = fakeApi(), env = {} } = {}) {
  const outLines = [], errLines = []
  let exitCode = null
  try {
    await main(argv, { SUPABASE_ACCESS_TOKEN: 'sbp_test', ...env }, {
      root,
      fetch: api.fetch,
      log: (...a) => outLines.push(a.join(' ')),
      error: (...a) => errLines.push(a.join(' ')),
      exit: (c) => { exitCode = exitCode ?? c },
    })
  } catch (e) {
    if (!(e instanceof ExitSignal)) throw e
  }
  return { out: outLines.join('\n'), err: errLines.join('\n'), exitCode, api }
}

// ── the guards ──────────────────────────────────────────────────────────────

describe('production is refused', () => {
  it('refuses `up` against a production ref without MIGRATE_ALLOW_PROD', async () => {
    write('001-a.sql', 'select 1;')
    const r = await run(['up', '--project', 'prod'])
    expect(r.exitCode).toBe(3)
    expect(r.err).toMatch(/refusing to up against PRODUCTION/)
    expect(r.api.sql).toHaveLength(0)          // it never reached the wire
  })

  it('refuses a production ref passed directly, not only the `prod` alias', () => {
    for (const ref of PROD_REFS) {
      const t = resolveTarget({ migrate_staging: STG }, ref, 'up', {})
      expect(t.code, `${ref} should be refused`).toBe(3)
    }
  })

  it('allows Lane 13 through with MIGRATE_ALLOW_PROD=1', () => {
    expect(resolveTarget({ migrate_prod: PROD }, 'prod', 'up', { MIGRATE_ALLOW_PROD: '1' }).error).toBeUndefined()
  })

  it('always allows the read-only commands on production', () => {
    for (const cmd of ['status', 'verify']) {
      expect(resolveTarget({ migrate_prod: PROD }, 'prod', cmd, {}).error).toBeUndefined()
    }
  })

  it('defaults to staging when no --project is given', async () => {
    const r = await run(['status'])
    expect(r.out).toContain(STG)
    expect(r.out).not.toContain(PROD)
  })

  it('never creates the ledger on production', async () => {
    const r = await run(['status', '--project', 'prod'])
    expect(r.api.sql.join('\n')).not.toMatch(/create table if not exists public\.schema_migrations/i)
  })
})

describe('the passport is the only source of targets', () => {
  it('refuses when the passport names no staging ref', async () => {
    fs.writeFileSync(path.join(root, 'SYSTEM.md'), '---\napp: test-repo\n---\n')
    const r = await run(['status'])
    expect(r.err).toMatch(/declares no `migrate_staging:` ref/)
    expect(r.exitCode).toBe(1)
  })

  it('refuses a repo with no SYSTEM.md at all', async () => {
    fs.rmSync(path.join(root, 'SYSTEM.md'))
    const r = await run(['status'])
    expect(r.err).toMatch(/no SYSTEM\.md/)
  })

  it('reads only top-level scalars, ignoring the nested passport lists', () => {
    const pp = readPassport(PASSPORT)
    expect(pp.app).toBe('test-repo')
    expect(pp.migrate_staging).toBe(STG)
    expect(pp.tables).toBeUndefined()
    expect(pp.owns).toBeUndefined()
  })

  it('refuses an unknown command before touching anything', async () => {
    const r = await run(['destroy'])
    expect(r.err).toMatch(/unknown command "destroy"/)
    expect(r.api.sql).toHaveLength(0)
  })
})

// ── the three drift kinds ───────────────────────────────────────────────────

describe('drift 1 — a file edited after it was applied', () => {
  it('status reports EDITED and up refuses', async () => {
    write('001-a.sql', 'select 2;')
    const api = fakeApi({ ledger: [{ name: '001-a.sql', checksum: sha('select 1;'), applied_at: '2026-08-11T00:00:00Z', applied_by: 'hand', source: 'runner' }] })
    const s = await run(['status'], { api })
    expect(s.out).toMatch(/EDITED\s+sql\/migrations\/001-a\.sql/)

    const u = await run(['up'], { api })
    expect(u.err).toMatch(/edited since they ran/)
    expect(u.api.sql.join('\n')).not.toContain('select 2;')
  })

  it('does not cry drift over Windows line endings', () => {
    expect(sha('create table x;\r\nselect 1;\r\n')).toBe(sha('create table x;\nselect 1;\n'))
  })
})

describe('drift 2 — applied but not in git (the 11/08 failure)', () => {
  const orphan = { name: '099-vanished.sql', checksum: 'deadbeef', applied_at: '2026-08-11T00:00:00Z', applied_by: 'pr416', source: 'runner' }

  it('classify names it', () => {
    const c = classify([], [orphan])
    expect(c.orphans.map(o => o.name)).toEqual(['099-vanished.sql'])
  })

  it('status prints ORPHAN', async () => {
    const r = await run(['status'], { api: fakeApi({ ledger: [orphan] }) })
    expect(r.out).toMatch(/ORPHAN\s+099-vanished\.sql/)
  })

  it('up refuses to move while one is open', async () => {
    write('001-a.sql', 'select 1;')
    const r = await run(['up'], { api: fakeApi({ ledger: [orphan] }) })
    expect(r.err).toMatch(/no file in git/)
    expect(r.api.sql.join('\n')).not.toContain('select 1;')
  })

  it('verify exits 1 on it', async () => {
    const r = await run(['verify'], { api: fakeApi({ ledger: [orphan] }) })
    expect(r.exitCode).toBe(1)
    expect(r.err).toMatch(/recorded applied with no file in git/)
  })
})

describe('drift 3 — SQL pasted in by hand', () => {
  const before = { 'column|jobs.id': 'aaaa', 'column|jobs.quote_number': 'bbbb' }

  it('status names the objects that appeared without a migration', async () => {
    const api = fakeApi({
      fingerprints: [seedFp(before)],
      // someone added a column and a grant in the dashboard
      objects: { ...before, 'column|jobs.snuck_in': 'cccc', 'grant|jobs.anon.UPDATE': 'y' },
    })
    const r = await run(['status'], { api })
    expect(r.out).toMatch(/SHAPE CHANGED SINCE THE LAST RECORDED FINGERPRINT — 2 object/)
    expect(r.out).toContain('column jobs.snuck_in')
    expect(r.out).toContain('grant jobs.anon.UPDATE')
  })

  it('verify exits 1 on it', async () => {
    const api = fakeApi({
      fingerprints: [seedFp(before)],
      objects: { ...before, 'index|jobs_secret_idx': 'dddd' },
    })
    const r = await run(['verify'], { api })
    expect(r.exitCode).toBe(1)
    expect(r.err).toMatch(/changed outside the runner/)
    expect(r.err).toContain('index jobs_secret_idx')
  })

  it('verify is silent and exits 0 when the shape still matches', async () => {
    const api = fakeApi({
      fingerprints: [seedFp(before)],
      objects: before,
    })
    const r = await run(['verify'], { api })
    expect(r.exitCode).toBeNull()
    expect(r.err).toBe('')
  })

  it('diffObjects separates added, removed and changed', () => {
    const d = diffObjects({ a: '1', b: '2', c: '3' }, { a: '1', b: '9', d: '4' })
    expect(d).toEqual({ added: ['d'], removed: ['c'], changed: ['b'] })
  })
})

// ── applying ────────────────────────────────────────────────────────────────

describe('up', () => {
  it('applies a pending file, records it, and fingerprints afterwards', async () => {
    write('001-a.sql', 'create table a();')
    const api = fakeApi({ objects: { 'column|a.id': 'z' } })
    const r = await run(['up'], { api })
    const sql = api.sql.join('\n')
    expect(sql).toContain('create table a();')
    expect(sql).toMatch(/insert into public\.schema_migrations \(repo, name, checksum/)
    expect(sql).toContain(sha('create table a();'))
    expect(sql).toMatch(/insert into public\.schema_fingerprint/)
    expect(r.out).toContain('applied 001-a.sql')
  })

  it('skips a file whose checksum still matches', async () => {
    write('001-a.sql', 'create table a();')
    const api = fakeApi({ ledger: [{ name: '001-a.sql', checksum: sha('create table a();'), applied_at: '2026-09-01', applied_by: 'x', source: 'runner' }] })
    const r = await run(['up'], { api })
    expect(api.sql.join('\n')).not.toContain('create table a();')
    expect(r.out).toContain('Nothing to apply')
  })

  it('applies in lexical order and ignores files that are not NNN-slug.sql', async () => {
    write('002-b.sql', 'select 2;'); write('001-a.sql', 'select 1;')
    write('2026-09-07-hand-written.sql', 'select 999;')
    write('README.md', 'not sql')
    expect(discoverIn(root, 'sql/migrations').map(f => f.name)).toEqual(['001-a.sql', '002-b.sql'])
    const api = fakeApi()
    await run(['up'], { api })
    const joined = api.sql.join('\n')
    expect(joined.indexOf('select 1;')).toBeLessThan(joined.indexOf('select 2;'))
    expect(joined).not.toContain('select 999;')
  })

  it('--dry-run changes nothing', async () => {
    write('001-a.sql', 'create table a();')
    const api = fakeApi()
    const r = await run(['up', '--dry-run'], { api })
    expect(r.out).toContain('would apply 1')
    expect(api.sql.join('\n')).not.toContain('create table a();')
  })

  it('wraps a migration in a transaction, and honours the opt-out', () => {
    expect(transactional('select 1;')).toBe('begin;\nselect 1;\ncommit;')
    expect(transactional('-- migrate: no-transaction\ncreate index concurrently i on t(x);')).not.toContain('begin;')
    expect(transactional('begin;\nselect 1;\ncommit;')).toBe('begin;\nselect 1;\ncommit;')
  })

  // isUntransactioned is what `up` branches on to decide whether a migration and
  // its ledger row can commit together. It was imported here and never called,
  // which is how a lint warning came to be the only thing standing between this
  // predicate and no direct coverage at all.
  it('recognises the no-transaction marker however it is spaced', () => {
    expect(isUntransactioned('-- migrate: no-transaction\ncreate index concurrently i on t(x);')).toBe(true)
    expect(isUntransactioned('--migrate:no-transaction\nselect 1;')).toBe(true)
    expect(isUntransactioned('--   migrate:   no-transaction\nselect 1;')).toBe(true)
  })

  it('leaves an ordinary migration on the atomic path', () => {
    expect(isUntransactioned('create table t (id int);')).toBe(false)
    expect(isUntransactioned('-- adds a no-transaction column\nselect 1;')).toBe(false)
    expect(isUntransactioned('')).toBe(false)
  })

  // THE MARKER IS NOT ANCHORED TO THE FIRST LINE. Pinned because it is the real
  // behaviour and `up` depends on it, not because it is desirable: a comment
  // anywhere in the file — including one warning a reader OFF the opt-out —
  // silently drops that migration off the atomic path, and the only sign is one
  // line of output. Worth anchoring to the header when there is a live database
  // to re-verify against.
  it('finds the marker anywhere in the body, which is a footgun worth knowing about', () => {
    expect(isUntransactioned('select 1;\n-- migrate: no-transaction\nselect 2;')).toBe(true)
  })
})

// ── the lock ────────────────────────────────────────────────────────────────

describe('the shared-database lock', () => {
  it('claims and releases it around a shared-database migration', async () => {
    write('001-a.sql', 'select 1;')
    const api = fakeApi()
    await run(['up'], { api })
    const sql = api.sql.join('\n')
    expect(sql).toMatch(/update public\.coordination_lock[\s\S]*holder is null/)
    expect(sql).toMatch(/set holder = null, note = 'FREE'/)
    expect(api.lockHolder).toBeNull()
  })

  it('STOPS when the lock is held — it does not warn and carry on', async () => {
    write('001-a.sql', 'select 1;')
    const api = fakeApi({ lockHolder: 'lane 7' })
    const r = await run(['up'], { api })
    expect(r.err).toMatch(/lock is held by "lane 7"/)
    expect(api.sql.join('\n')).not.toContain('select 1;')
  })

  it('STOPS when the lock row is missing rather than assuming it is free', async () => {
    write('001-a.sql', 'select 1;')
    const api = fakeApi({ lockHolder: 'x', lockRow: false })
    const r = await run(['up'], { api })
    expect(r.err).toMatch(/coordination lock row does not exist/)
    expect(api.sql.join('\n')).not.toContain('select 1;')
  })

  it('releases the lock when a migration fails', async () => {
    write('001-a.sql', 'boom;')
    const api = fakeApi()
    const realFetch = api.fetch
    api.fetch = async (url, init) => {
      if (JSON.parse(init.body).query.includes('boom;')) return new Response('syntax error', { status: 400 })
      return realFetch(url, init)
    }
    await run(['up'], { api }).catch(() => {})
    expect(api.sql.join('\n')).toMatch(/set holder = null, note = 'FREE'/)
  })

  it('does not reach for a lock on a database that has none', async () => {
    fs.writeFileSync(path.join(root, 'SYSTEM.md'), `---\napp: test-repo\nmigrate_staging: tvknxjkfzipffykcvvyt\n---\n`)
    write('001-a.sql', 'select 1;')
    const api = fakeApi()
    await run(['up'], { api })
    expect(api.sql.join('\n')).not.toContain('coordination_lock')
  })

  it('locks the SHARED clone as well as SHARED itself — five repos migrate it', () => {
    expect(SHARED_REFS.has(PROD)).toBe(true)
    expect(SHARED_REFS.has(STG)).toBe(true)
  })
})

// ── reconciliation ──────────────────────────────────────────────────────────

describe('mark-applied', () => {
  it('records the file without running it', async () => {
    write('001-a.sql', 'drop table everything;')
    const api = fakeApi()
    const r = await run(['mark-applied', '001-a.sql', '--why', 'went in by hand 12/08'], { api })
    const sql = api.sql.join('\n')
    expect(sql).not.toContain('drop table everything;')
    expect(sql).toMatch(/'reconciled', 'went in by hand 12\/08'/)
    expect(r.out).toContain('recorded 001-a.sql')
  })

  it('refuses without --why, because it is a claim about the past', async () => {
    write('001-a.sql', 'select 1;')
    const r = await run(['mark-applied', '001-a.sql'])
    expect(r.err).toMatch(/needs --why/)
    expect(r.api.sql).toHaveLength(0)
  })

  it('refuses a file that is not in the managed directory', async () => {
    const r = await run(['mark-applied', 'nope.sql', '--why', 'x'])
    expect(r.err).toMatch(/is not in sql\/migrations/)
  })
})

describe('accept', () => {
  it('refuses without --why, because it silences an alarm', async () => {
    const r = await run(['accept'])
    expect(r.err).toMatch(/needs --why/)
  })

  it('records a new expected shape', async () => {
    const api = fakeApi({ objects: { 'column|a.id': 'z' } })
    const r = await run(['accept', '--why', 'Lane 2 baseline'], { api })
    expect(api.sql.join('\n')).toMatch(/insert into public\.schema_fingerprint/)
    expect(r.out).toMatch(/fingerprint [0-9a-f]{12} over 1 objects/)
  })
})

// ── odds and ends ───────────────────────────────────────────────────────────

describe('helpers', () => {
  it('quote escapes single quotes and renders null', () => {
    expect(quote("O'Brien")).toBe("'O''Brien'")
    expect(quote(null)).toBe('null')
  })

  it('the ledger is keyed by repo, because five repos migrate one database', async () => {
    write('001-a.sql', 'select 1;')
    const api = fakeApi()
    await run(['up'], { api })
    expect(api.sql.join('\n')).toMatch(/where repo = 'test-repo'/)
    expect(api.sql.join('\n')).toMatch(/values \('test-repo', '001-a\.sql'/)
  })

  it('every call goes to the real Management API host', async () => {
    await run(['status'])
    // the fake records the URL the runner built; there is no way to redirect it
    const api = fakeApi()
    await run(['status'], { api })
    for (const u of api.urls) expect(u).toMatch(/^https:\/\/api\.supabase\.com\/v1\/projects\/[a-z]{20}\/database\/query$/)
  })
})

// ── the five defects found reviewing the recovered draft (Lane 9, 07/09/2026) ──
//
// Every one of these passed review as written prose and failed as code. They are
// tested here because the draft's own test suite was green while all five were
// live: the fake API never exercised the paths that were wrong.

describe('the passport is the allow-list, not a hard-coded denylist', () => {
  it('refuses a raw --project ref the passport does not name', () => {
    const t = resolveTarget({ migrate_staging: STG, migrate_prod: PROD }, 'abcdefghijklmnopqrst', 'status', {})
    expect(t.code).toBe(1)
    expect(t.error).toMatch(/is not a database this repo may touch/)
  })

  it('`status` on an undeclared ref never reaches the wire — it used to run LEDGER_DDL there', async () => {
    const r = await run(['status', '--project', 'abcdefghijklmnopqrst'])
    expect(r.exitCode).toBe(1)
    expect(r.api.sql).toHaveLength(0)
  })

  it('LEDGER_DDL really does rename an existing table, which is why the above matters', () => {
    expect(LEDGER_DDL).toMatch(/alter table public\.schema_migrations rename to schema_migrations_pre_lane2/)
  })

  it('accepts a ref the passport names outright, not only via an alias', () => {
    expect(resolveTarget({ migrate_staging: STG }, STG, 'up', {}).error).toBeUndefined()
  })

  it('accepts a ref containing digits (the first draft demanded letters only)', () => {
    const withDigits = 'nncyevanthndcwbdbolk'.slice(0, 18) + 'k9'
    expect(resolveTarget({ migrate_staging: withDigits }, withDigits, 'up', {}).error).toBeUndefined()
  })
})

describe('no command means no run', () => {
  it('`npm run migrate -- --project staging` refuses instead of silently doing status', async () => {
    write('001-a.sql', 'select 1;')
    const r = await run(['--project', 'staging'])
    expect(r.exitCode).toBe(1)
    expect(r.err).toMatch(/no command given/)
    expect(r.api.sql).toHaveLength(0)
  })

  it('an explicit command still works', async () => {
    write('001-a.sql', 'select 1;')
    const r = await run(['up', '--project', 'staging'])
    expect(r.exitCode).toBeNull()
    expect(r.out).toMatch(/applied 001-a\.sql/)
  })
})

describe('a migration and its ledger row commit together', () => {
  it('one round trip carries both, so a torn apply cannot leave an unrecorded change', async () => {
    write('001-a.sql', 'create table t (id int);')
    const api = fakeApi()
    await run(['up'], { api })
    const combined = api.sql.find(q => q.includes('create table t') && q.includes('insert into public.schema_migrations'))
    expect(combined, 'the migration body and the ledger insert must be one statement').toBeTruthy()
    expect(combined.trim().startsWith('begin;')).toBe(true)
    expect(combined.trim().endsWith('commit;')).toBe(true)
  })

  it('a no-transaction migration is applied separately AND says so', async () => {
    write('001-a.sql', '-- migrate: no-transaction\ncreate index concurrently i on t (id);')
    const api = fakeApi()
    const r = await run(['up'], { api })
    expect(r.out).toMatch(/no-transaction/)
    expect(api.sql.some(q => q.includes('create index concurrently') && !q.includes('insert into public.schema_migrations'))).toBe(true)
  })
})

describe('the drift alarm does not cry wolf about the runner\'s own work', () => {
  it('fingerprints after EVERY migration, not once at the end', async () => {
    write('001-a.sql', 'select 1;')
    write('002-b.sql', 'select 2;')
    const api = fakeApi()
    await run(['up'], { api })
    const taken = api.sql.filter(q => q.includes('insert into public.schema_fingerprint'))
    expect(taken).toHaveLength(2)
  })
})

describe('--only selects one migration, not all of them', () => {
  it('`--only .sql` is not a wildcard', async () => {
    write('001-a.sql', 'select 1;')
    write('002-b.sql', 'select 2;')
    const r = await run(['up', '--only', '.sql'])
    expect(r.exitCode).toBe(1)
    expect(r.err).toMatch(/is not a pending migration/)
  })

  it('the three-digit number selects exactly its own file', async () => {
    write('001-a.sql', 'select 1;')
    write('002-b.sql', 'select 2;')
    const r = await run(['up', '--only', '002'])
    expect(r.out).toMatch(/applied 002-b\.sql/)
    expect(r.out).not.toMatch(/applied 001-a\.sql/)
  })
})

// ---------------------------------------------------------------------------
// THE CARRY-OVER TRAP. LEDGER_DDL renames a pre-Lane-2 schema_migrations and
// creates the new one empty, so every already-applied migration reads PENDING.
// Staging is already in that state (1 row new, 7 in _pre_lane2) and Lane 13
// meets it on PRODUCTION at cutover, where re-running applied migrations is the
// exact damage this runner exists to prevent.
describe('a renamed pre-Lane-2 ledger is never silently treated as "nothing applied"', () => {
  it('status names the pending files that have already run, and only those', async () => {
    write('001-a.sql', 'create table a();')
    write('002-b.sql', 'create table b();')
    // 001 already ran and its history is stranded in _pre_lane2; 002 is genuinely new.
    const r = await run(['status', '--project', STG], { api: fakeApi({ preLane2: ['sql/migrations/001-a.sql'] }) })
    expect(r.out).toContain('schema_migrations_pre_lane2')
    expect(r.out).toMatch(/OVERSTATES/)
    expect(r.out).toContain('mark-applied 001-a.sql')
    // and it must NOT tell you to carry over the one that never ran
    expect(r.out).not.toContain('mark-applied 002-b.sql')
  })

  it('matches ids recorded repo-qualified as well as bare — schema_migrations is SHARED', async () => {
    write('001-a.sql', 'create table a();')
    const r = await run(['status', '--project', STG], {
      api: fakeApi({ preLane2: ['hytek-detailing/sql/migrations/001-a.sql'] }),
    })
    expect(r.out).toContain('mark-applied 001-a.sql')
  })

  it('up REFUSES rather than re-running history that is already in the database', async () => {
    write('001-a.sql', 'create table a();')
    const api = fakeApi({ preLane2: ['sql/migrations/001-a.sql'] })
    const r = await run(['up', '--project', STG], { api })
    expect(r.exitCode).not.toBe(0)
    expect(r.err + r.out).toContain('ALREADY RUN')
    expect(api.sql.some((q) => q.includes('create table a()'))).toBe(false)
    expect(api.ledger).toHaveLength(0)
  })

  it('SAYS NOTHING once the carry-over is done — a warning that keeps shouting gets ignored', async () => {
    // The real case, met on staging 08/09/2026: _pre_lane2 still holds seven rows,
    // but every one has been carried across, so the pending list IS the truth.
    write('001-a.sql', 'create table a();')
    const r = await run(['status', '--project', STG], {
      api: fakeApi({ preLane2: ['sql/migrations/999-long-since-carried.sql'] }),
    })
    expect(r.out).not.toContain('OVERSTATES')
    expect(r.out).not.toContain('pre_lane2')
  })

  it('and up runs normally in that state', async () => {
    write('001-a.sql', 'create table a();')
    const api = fakeApi({ preLane2: ['sql/migrations/999-long-since-carried.sql'] })
    const r = await run(['up', '--project', STG], { api })
    expect(r.exitCode ?? 0).toBe(0)
    expect(api.sql.some((q) => q.includes('create table a()'))).toBe(true)
  })

  it('says nothing when there is no carried-over ledger at all', async () => {
    write('001-a.sql', 'create table a();')
    const r = await run(['status', '--project', STG])
    expect(r.out).not.toContain('pre_lane2')
  })

  it('asks whether the table exists BEFORE reading it — a bare select is a 42P01', async () => {
    write('001-a.sql', 'create table a();')
    const api = fakeApi({ preLane2: null })
    await run(['status', '--project', STG], { api })
    const asked = api.sql.findIndex((q) => q.includes("to_regclass('public.schema_migrations_pre_lane2')"))
    const readIt = api.sql.findIndex((q) => q.includes('id from public.schema_migrations_pre_lane2'))
    expect(asked).toBeGreaterThanOrEqual(0)
    expect(readIt).toBe(-1)
  })
})

// ── grants are read the same whoever runs the runner (D104, 28/09/2026) ─────
//
// The grant branch used information_schema.role_table_grants, which only lists
// grants the CURRENT role takes part in. Under supabase_read_only_user it saw
// none, and `status` reported 891 objects "changed" on PLANNER when nothing had.
// It now reads pg_class.relacl through aclexplode. The rule for that change:
// for every grant a SUPERUSER saw through the view, the new branch must produce
// the SAME key, or every recorded fingerprint drifts and needs a mass re-accept.
//
// The fixture below is a small `public` schema whose ACLs cover each case that
// could make the two differ. `viewAsSuperuser` is information_schema.table_privileges
// as Postgres 17 defines it (src/backend/catalog/information_schema.sql),
// seen by a superuser, then filtered the way the OLD branch filtered it.
// `newBranch` applies the filters parsed out of the SHIPPED FINGERPRINT_SQL, so
// editing the SQL (a relkind, a privilege word, a role) changes this test's result.

const ACL_LETTERS = { r: 'SELECT', a: 'INSERT', w: 'UPDATE', d: 'DELETE', D: 'TRUNCATE', x: 'REFERENCES', t: 'TRIGGER', m: 'MAINTAIN', U: 'USAGE' }

/** aclexplode(): '{anon=arw/postgres,=r/postgres}' → one row per privilege. '' grantee = PUBLIC (oid 0). */
function aclexplode(acl) {
  return acl.replace(/^\{|\}$/g, '').split(',').filter(Boolean).flatMap((item) => {
    const [grantee, rest] = item.split('=')
    const [privs, grantor] = rest.split('/')
    return [...privs.replace(/\*/g, '')].map((ch) => ({ grantee: grantee || 'PUBLIC', grantor, privilege_type: ACL_LETTERS[ch] }))
  })
}
/** acldefault('r', owner) on Postgres 17: the owner holds everything, MAINTAIN included. */
const acldefault = (owner) => `{${owner}=arwdDxtm/${owner}}`

const GRANT_FIXTURE = [
  // ordinary table: the three API roles, two grantors for one privilege, a PUBLIC grant, MAINTAIN in the ACL
  { nsp: 'public', relname: 'jobs', relkind: 'r', owner: 'postgres',
    acl: '{postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=arwd/postgres,authenticated=r/supabase_admin,service_role=arwdDxtm/postgres,=r/postgres,app_hub=rw/postgres}' },
  // grant option (*) on a privilege
  { nsp: 'public', relname: 'quotes', relkind: 'r', owner: 'postgres', acl: '{postgres=arwdDxtm/postgres,service_role=r*w*/postgres}' },
  // never granted: NULL relacl falls back to the owner's default
  { nsp: 'public', relname: 'fresh', relkind: 'r', owner: 'postgres', acl: null },
  // NULL relacl on a table an API role OWNS: the default ACL gives it every privilege
  { nsp: 'public', relname: 'owned_by_service', relkind: 'r', owner: 'service_role', acl: null },
  { nsp: 'public', relname: 'jobs_safe', relkind: 'v', owner: 'postgres', acl: '{postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=r/postgres}' },
  { nsp: 'public', relname: 'events', relkind: 'p', owner: 'postgres', acl: '{postgres=arwdDxtm/postgres,authenticated=ar/postgres}' },
  { nsp: 'public', relname: 'ext_rates', relkind: 'f', owner: 'postgres', acl: '{postgres=arwdDxtm/postgres,anon=r/postgres}' },
  // kinds the view never lists: sequence, materialised view, index
  { nsp: 'public', relname: 'jobs_id_seq', relkind: 'S', owner: 'postgres', acl: '{postgres=rwU/postgres,anon=rwU/postgres}' },
  { nsp: 'public', relname: 'weekly_mv', relkind: 'm', owner: 'postgres', acl: '{postgres=arwdDxtm/postgres,authenticated=r/postgres}' },
  // another schema: never in the fingerprint
  { nsp: 'auth', relname: 'users', relkind: 'r', owner: 'supabase_auth_admin', acl: '{supabase_auth_admin=arwdDxtm/supabase_auth_admin,service_role=arwd/supabase_auth_admin}' },
]
const explodeAll = (fixture) => fixture.flatMap((c) =>
  aclexplode(c.acl ?? acldefault(c.owner)).map((a) => ({ ...c, ...a })))

/** The OLD branch as a superuser saw it: table_privileges' own filters, then the fingerprint's. */
function viewAsSuperuser(fixture) {
  return explodeAll(fixture)
    .filter((r) => ['r', 'v', 'f', 'p'].includes(r.relkind))
    .filter((r) => ['INSERT', 'SELECT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'].includes(r.privilege_type))
    .filter((r) => r.nsp === 'public' && ['anon', 'authenticated', 'service_role'].includes(r.grantee))
    .map((r) => `grant|${r.relname}.${r.grantee}.${r.privilege_type}`)
}

const grantBranch = () => {
  const m = /select 'grant'[\s\S]*?(?=\nunion all)/.exec(FINGERPRINT_SQL)
  if (!m) throw new Error('no grant branch in FINGERPRINT_SQL')
  return m[0]
}
const inList = (sql, column) => {
  const m = new RegExp(`${column.replace('.', '\\.')} in \\(([^)]*)\\)`).exec(sql)
  if (!m) throw new Error(`no "${column} in (…)" in the grant branch`)
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''))
}

/** The NEW branch: the same exploded ACL, filtered by what the shipped SQL says. */
function newBranch(fixture) {
  const sql = grantBranch()
  const kinds = inList(sql, 'c.relkind'), privs = inList(sql, 'a.privilege_type'), roles = inList(sql, 'g.rolname')
  const schema = /n\.nspname = '([^']+)'/.exec(sql)[1]
  return explodeAll(fixture)
    .filter((r) => r.nsp === schema && kinds.includes(r.relkind) && privs.includes(r.privilege_type) && roles.includes(r.grantee))
    .map((r) => `grant|${r.relname}.${r.grantee}.${r.privilege_type}`)
}

describe('grant fingerprint reads pg_class.relacl, not information_schema (D104)', () => {
  it('no longer depends on who runs it', () => {
    const sql = grantBranch()
    expect(sql).not.toMatch(/information_schema/)
    expect(sql).toMatch(/aclexplode\(coalesce\(c\.relacl, acldefault\('r', c\.relowner\)\)\)/)
    expect(sql).toMatch(/join pg_roles g on g\.oid = a\.grantee/)
    expect(sql).toMatch(/'grant', c\.relname \|\| '\.' \|\| g\.rolname \|\| '\.' \|\| a\.privilege_type, 'y'/)
  })

  it('produces exactly the keys a superuser saw through the old view', () => {
    const before = [...new Set(viewAsSuperuser(GRANT_FIXTURE))].sort()
    const after = [...new Set(newBranch(GRANT_FIXTURE))].sort()
    expect(after).toEqual(before)
    // the fixture really exercises the edges, so an empty or trivial pass is impossible
    expect(before).toContain('grant|jobs.authenticated.SELECT')          // two grantors, one key
    expect(before).toContain('grant|quotes.service_role.UPDATE')         // grant option
    expect(before).toContain('grant|owned_by_service.service_role.TRUNCATE') // NULL relacl default
    expect(before).toContain('grant|ext_rates.anon.SELECT')              // foreign table
    expect(before).toContain('grant|events.authenticated.INSERT')        // partitioned table
    expect(before.some((k) => k.endsWith('.MAINTAIN'))).toBe(false)     // Postgres 17 MAINTAIN excluded
    expect(before.some((k) => /jobs_id_seq|weekly_mv|users|app_hub|PUBLIC/.test(k))).toBe(false)
    expect(before).toHaveLength(26)
  })

  it('a fingerprint recorded with the old branch still matches — no mass re-accept', async () => {
    const other = { 'column|jobs.id': 'uuid not null' }
    const recorded = Object.fromEntries(viewAsSuperuser(GRANT_FIXTURE).map((k) => [k, 'y']))
    const now = Object.fromEntries(newBranch(GRANT_FIXTURE).map((k) => [k, 'y']))
    const api = fakeApi({ fingerprints: [seedFp({ ...other, ...recorded })], objects: { ...other, ...now } })
    const r = await run(['verify'], { api })
    expect(r.exitCode).toBeNull()
    expect(r.err).toBe('')
  })
})


// ---------------------------------------------------------------------------
// THE COPY IS THE RULE, AND UNTIL NOW NOTHING CHECKED IT.
//
// Lane 0 §9: every app repo carries a byte-identical copy of the runner at
// scripts/migrate.mjs, and you never edit an app copy — you change
// hytek-brain/tool/migrate.mjs and re-copy.
//
// That was a sentence in a document, so it drifted, and it drifted FAST. Within
// two days of the rule being written, hytek-lws, hytek-invoicing and hytek-fab
// had each independently fixed the same `pg_sequences.data_type` cast in their
// OWN vendored copy. The suite was running two different runners and the
// canonical one was the broken one — the file every other repo was told to copy
// from had never been run against a real database.
//
// So this is the rule enforced by code instead. Change the runner and this test
// goes red until you update the hash in the SAME canonical pair and re-vendor
// both files together. Edit a copy locally and it goes red immediately, which
// is what would have caught all three of those repos at the pull request.
//
// Line endings are normalised before hashing. hytek-brain checks out CRLF on a
// Windows machine while the app repos check out LF, so comparing raw bytes
// reports drift in every repo, every time, while the git blobs are identical —
// a check that cries wolf weekly is a check that gets ignored within a month.
const CANONICAL_RUNNER_SHA256 = '1a1ff6f081d72d87334f7518f3f6f8bf43005c0cf86364304e1d42230a0fe48e'

describe('the vendored runner is byte-identical to hytek-brain/tool/migrate.mjs', () => {
  it('matches the canonical hash — if this fails, do NOT edit the hash to match', () => {
    const runner = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrate.mjs')
    const normalised = fs.readFileSync(runner, 'utf8').replace(/\r\n/g, '\n')
    const actual = crypto.createHash('sha256').update(normalised).digest('hex')
    expect(
      actual,
      'This copy of migrate.mjs has drifted from hytek-brain/tool/migrate.mjs. ' +
        'Do not fix it here and do not update this hash: change the canonical file, ' +
        're-copy it and this test to every repo, and log it (Lane 0 §9). ' +
        'Three repos each fixed the same bug in their own copy and the canonical ' +
        'one stayed broken — this test exists so that cannot happen quietly again.',
    ).toBe(CANONICAL_RUNNER_SHA256)
  })
})
