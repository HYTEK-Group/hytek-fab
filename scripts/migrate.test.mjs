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
import {
  main, sha, quote, readPassport, resolveTarget, discoverIn, diffObjects,
  classify, transactional, PROD_REFS, SHARED_REFS, ExitSignal, LEDGER_DDL, isUntransactioned,
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
function fakeApi({ ledger = [], fingerprints = [], lockHolder = null, lockRow = true, objects = {} } = {}) {
  const state = { ledger, fingerprints, lockHolder, lockRow, objects, sql: [], urls: [] }
  const reply = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  state.fetch = async (url, init) => {
    const q = JSON.parse(init.body).query
    state.sql.push(q)
    state.urls.push(String(url))
    const l = q.toLowerCase()

    if (l.includes("to_regclass('public.schema_migrations')")) return reply([{ ok: true }])
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
