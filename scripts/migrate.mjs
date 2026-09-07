#!/usr/bin/env node
// THE MIGRATION RUNNER — canonical copy.
// Every app repo carries a byte-identical copy at scripts/migrate.mjs.
// Never edit an app-repo copy: change this file, re-copy, and log it (Lane 0 §9).
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS, AND WHY IT IS SHAPED LIKE THIS
//
// Root CLAUDE.md rule 6 says "migrations go through the runner and
// schema_migrations. Never paste SQL into a dashboard." That rule has been
// written down since June and enforced by nothing, so every migration in this
// suite went in by hand and "is it applied?" was unanswerable from git.
//
// WHY-IT-DRIFTED.md is unambiguous about what happens next: a rule enforced by
// a document drifts, every time it has been tried here; a rule enforced by code
// or by the database holds. So this runner does not ask anyone to behave. It
// makes the three failures VISIBLE, and refuses to move while one is open:
//
//   1. FILE EDITED AFTER APPLYING. The database ran the old text. Changing the
//      file desynchronises git from reality without changing the database.
//      Caught by checksum. Write a new migration instead.
//
//   2. APPLIED BUT NOT IN GIT (an "orphan"). This is the 11/08 failure: PR #416
//      reported merged, its commits never landed, and a live database change was
//      left with no code anywhere. A ledger row with no matching file says so,
//      by name, on every run.
//
//   3. HAND-PASTED SQL — the one no door-level rule can catch, and the one that
//      actually broke this system (02/09: 61 jobs written by raw SQL underneath
//      every door). The runner records a FINGERPRINT of the whole schema after
//      every action: one hash per column, constraint, index, view, function,
//      trigger, policy, grant and sequence. If the live shape stops matching the
//      recorded one and no migration explains it, `status` names the objects
//      that changed and `verify` exits non-zero. A dashboard paste cannot hide.
//
// It cannot PREVENT a dashboard paste — nothing short of revoking the dashboard
// can. It makes one impossible to keep quiet, which is the next best thing and
// is more than anything in this suite has ever had.
//
// ---------------------------------------------------------------------------
// USAGE
//   node scripts/migrate.mjs status                 what has run, what is pending, what drifted
//   node scripts/migrate.mjs verify                 the gate: silent on success, exit 1 on any drift
//   node scripts/migrate.mjs up                     apply everything pending
//   node scripts/migrate.mjs up --only 045-outbox.sql
//   node scripts/migrate.mjs up --dry-run           print, change nothing
//   node scripts/migrate.mjs mark-applied 001-x.sql --why "went in by hand 12/08; reconciled by Lane 2"
//   node scripts/migrate.mjs accept --why "…"       record the current shape as the expected one
//
//   --project staging (default) | prod | <20-char ref>
//
// TARGETS come from this repo's SYSTEM.md passport, not from this file, so the
// passport stays the one place that says which database a repo may migrate:
//   migrations_dir: sql/migrations
//   migrate_staging: nncyevanthndcwbdbolk    # THIS repo's staging clone
//   migrate_prod: suyvtczfwvqoefpyiqoi       # THIS repo's production database
//
// Those two refs are hytek-lws's. Copy this header into another repo and you
// MUST change them: the first draft carried SHARED's refs as the example, which
// would have pointed the LWS repo's migrations at the operations database. A
// ref the passport does not name is now refused outright, so that mistake fails
// instead of running.
//
// PRODUCTION is refused for anything that writes unless MIGRATE_ALLOW_PROD=1.
// That is Lane 13's cutover window and nobody else's. `status` and `verify` are
// always allowed on production and never create anything there.
//
// CREDENTIAL: SUPABASE_ACCESS_TOKEN (an sbp_… Management API token), or --token.
// The anon and service-role keys speak PostgREST, which cannot run CREATE TABLE.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'

// ── constants ───────────────────────────────────────────────────────────────

/** Every production database in the suite. Hard-coded as well as read from the
 *  passport, so a mistyped passport still cannot aim DDL at production. */
export const PROD_REFS = new Set([
  'gqtikzguvhukpujyxkez', // SHARED / OPERATIONS
  'tucmestzvmfmuxglhlru', // INVOICING / FINANCE
  'vyzqxxixhhrqzpxkggfy', // PLANNER
  'bjmysfciltrlrycfgqkj', // PLANNER-HB
  'suyvtczfwvqoefpyiqoi', // LWS
  'wgcqiuwdiknoxtduriki', // JOB-REGISTER
])

/** The SHARED database and its clone. Scott's hard rule: claim
 *  coordination_lock before ANY gqtikz SQL. The clone gets the same treatment
 *  because five repos migrate it and they collide the same way. */
export const SHARED_REFS = new Set(['gqtikzguvhukpujyxkez', 'lvjxqygftugmcadstpff'])
const LOCK_RESOURCE = 'gqtikz'
const LOCK_STALE_MINUTES = 30
const READ_ONLY_CMDS = new Set(['status', 'verify'])

// ── pure helpers (exported so the tests can reach them without a network) ────

/** Checksums normalise line endings. Git on Windows rewrites them on checkout,
 *  and a checksum that changes between machines turns the drift alarm into
 *  noise, which is how alarms get switched off. */
export const sha = (s) => crypto.createHash('sha256').update(String(s).replace(/\r\n/g, '\n')).digest('hex')

export const quote = (s) => (s === null || s === undefined ? 'null' : `'${String(s).replace(/'/g, "''")}'`)

/** Top-level scalar keys out of a SYSTEM.md front-matter block. Deliberately
 *  tiny: the runner only needs app / migrations_dir / migrate_*. */
export function readPassport(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) throw new Error('SYSTEM.md has no YAML front-matter')
  const out = {}
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '')
    if (!/^\S/.test(line)) continue
    const i = line.indexOf(':')
    if (i < 0) continue
    const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '')
    if (v) out[line.slice(0, i).trim()] = v
  }
  return out
}

/** Which database, and may this command touch it? Every refusal lives here so
 *  the test can assert on it without a token or a network. */
export function resolveTarget(pp, alias, cmd, env = process.env) {
  const ref = alias === 'staging' ? pp.migrate_staging : alias === 'prod' ? pp.migrate_prod : alias
  if (!ref) {
    return { error: `SYSTEM.md declares no \`migrate_${alias}:\` ref. Add it to the passport — the runner will not accept a database the passport does not name.`, code: 1 }
  }
  // 20 lower-case ALPHANUMERICS. The first draft said letters only, which
  // refuses a legitimate ref containing a digit and reads like a runner bug.
  if (!/^[a-z0-9]{20}$/.test(ref)) return { error: `"${ref}" is not a Supabase project ref (20 lower-case letters or digits)`, code: 1 }

  const isProd = PROD_REFS.has(ref)
  if (isProd && !READ_ONLY_CMDS.has(cmd) && env.MIGRATE_ALLOW_PROD !== '1') {
    return {
      ref, isProd,
      error: `refusing to ${cmd} against PRODUCTION ${ref}.\n` +
             `    Production migrations happen in the Lane 13 cutover window and nowhere else.\n` +
             `    Everything else goes to staging first:  node scripts/migrate.mjs ${cmd} --project staging\n` +
             `    If you really are Lane 13:              MIGRATE_ALLOW_PROD=1 node scripts/migrate.mjs ${cmd} --project prod`,
      code: 3,
    }
  }

  // THE PASSPORT IS THE ALLOW-LIST, and this is the whole point of the file.
  //
  // The first draft accepted any raw `--project <ref>` and checked it only
  // against PROD_REFS — a hard-coded list of the six production databases
  // someone happened to know about. That is allow-BY-OMISSION: every ref not on
  // that list counted as safe. A seventh production project nobody had added
  // yet, another team's database, a one-character typo of a real ref — all
  // permitted. And `status`, documented at the top of this file as read-only
  // ("never create anything there"), calls ensureLedger(), whose first
  // statement RENAMES an existing public.schema_migrations table before
  // creating two more. So the read-only command wrote DDL into whichever
  // database you happened to name.
  //
  // A ref must now be one this repo's own passport names. Checked AFTER the
  // production refusal above, so a real production ref still gets the loud,
  // specific message about the cutover window rather than this generic one.
  const declared = new Set(
    [pp.migrate_staging, pp.migrate_prod, ...String(pp.project_refs ?? '').split(/[\s,[\]]+/)].filter(Boolean),
  )
  if (!declared.has(ref)) {
    return {
      ref, isProd,
      error: `"${ref}" is not a database this repo may touch.\n` +
             `    SYSTEM.md names: ${[...declared].join(', ') || '(none)'}\n` +
             `    The passport is the allow-list, not a denylist hard-coded in the runner.\n` +
             `    Add the ref to SYSTEM.md in a reviewed commit, or use --project staging|prod.`,
      code: 1,
    }
  }

  return { ref, isProd }
}

/** Migration files in lexical order, with checksums. Only NNN-slug.sql in the
 *  managed directory: the legacy date-named folders are frozen, never applied. */
export function discoverIn(root, dir) {
  const abs = path.join(root, dir)
  if (!fs.existsSync(abs)) return []
  return fs.readdirSync(abs)
    .filter(n => /^\d{3}-.+\.sql$/.test(n))
    .sort()
    .map(name => {
      const body = fs.readFileSync(path.join(abs, name), 'utf8')
      return { name, body, checksum: sha(body) }
    })
}

export function diffObjects(before, after) {
  const added = [], removed = [], changed = []
  for (const k of Object.keys(after)) {
    if (!(k in before)) added.push(k)
    else if (before[k] !== after[k]) changed.push(k)
  }
  for (const k of Object.keys(before)) if (!(k in after)) removed.push(k)
  return { added: added.sort(), removed: removed.sort(), changed: changed.sort() }
}

/** Everything the runner knows, given the files and what the ledger says.
 *  Pure, so the three drift kinds are unit-testable with no database at all. */
export function classify(files, ledgerRows) {
  const done = new Map(ledgerRows.map(r => [r.name, r]))
  const pending = [], edited = [], applied = []
  for (const f of files) {
    const row = done.get(f.name)
    if (!row) pending.push(f)
    else if (row.checksum !== f.checksum) edited.push({ ...f, row })
    else applied.push({ ...f, row })
  }
  const inGit = new Set(files.map(f => f.name))
  const orphans = ledgerRows.filter(r => !inGit.has(r.name))
  return { done, pending, edited, applied, orphans }
}

/** Wrap a migration in a transaction unless it opts out or already has one. */
/** True when a migration has opted out of the runner's transaction wrapper. */
export function isUntransactioned(body) {
  return /--\s*migrate:\s*no-transaction/.test(body)
}

export function transactional(body) {
  if (/--\s*migrate:\s*no-transaction/.test(body)) return body
  if (/^\s*begin\s*;/i.test(body)) return body
  return `begin;\n${body}\ncommit;`
}

// ── the ledger and the fingerprint ──────────────────────────────────────────

export const LEDGER_DDL = `
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='schema_migrations' and column_name='id')
     and not exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='schema_migrations' and column_name='repo') then
    alter table public.schema_migrations rename to schema_migrations_pre_lane2;
  end if;
end $$;

create table if not exists public.schema_migrations (
  repo        text        not null,
  name        text        not null,
  checksum    text        not null,
  applied_at  timestamptz not null default now(),
  applied_by  text        not null default current_user,
  source      text        not null default 'runner',
  note        text,
  primary key (repo, name)
);
alter table public.schema_migrations enable row level security;
revoke all on public.schema_migrations from anon, authenticated;

create table if not exists public.schema_fingerprint (
  id        bigserial   primary key,
  taken_at  timestamptz not null default now(),
  taken_by  text        not null default current_user,
  digest    text        not null,
  objects   jsonb       not null,
  reason    text,
  note      text
);
alter table public.schema_fingerprint enable row level security;
revoke all on public.schema_fingerprint from anon, authenticated;
`

/** One row per schema object. Anything that changes the shape of `public`
 *  changes this, whoever changed it and however they got in. */
export const FINGERPRINT_SQL = `
select 'column' as class, c.relname || '.' || a.attname as key,
       format_type(a.atttypid, a.atttypmod)
         || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
         || case when a.attnotnull then ' not null' else '' end as def
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
 where n.nspname = 'public' and c.relkind in ('r','p')
union all
select 'constraint', rel.relname || '.' || con.conname, pg_get_constraintdef(con.oid)
  from pg_constraint con join pg_class rel on rel.oid = con.conrelid
  join pg_namespace n on n.oid = rel.relnamespace where n.nspname = 'public'
union all
select 'index', indexname, indexdef from pg_indexes where schemaname = 'public'
union all
select 'view', viewname, md5(definition) from pg_views where schemaname = 'public'
union all
select 'matview', matviewname, md5(definition) from pg_matviews where schemaname = 'public'
union all
select 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
       md5(pg_get_functiondef(p.oid))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind in ('f','p')
union all
select 'trigger', c.relname || '.' || t.tgname, pg_get_triggerdef(t.oid)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and not t.tgisinternal
union all
select 'rls', c.relname, case when c.relrowsecurity then 'enabled' else 'disabled' end
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
union all
select 'policy', tablename || '.' || policyname,
       permissive || ' ' || cmd || ' to ' || array_to_string(roles, ',')
         || coalesce(' using ' || md5(qual), '') || coalesce(' check ' || md5(with_check), '')
  from pg_policies where schemaname = 'public'
union all
select 'grant', table_name || '.' || grantee || '.' || privilege_type, 'y'
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon','authenticated','service_role')
union all
-- data_type is regtype, every other branch of this UNION yields text, and
-- Postgres refuses to match them ("42804: UNION types text and regtype cannot
-- be matched"). The whole fingerprint query failed on the first REAL database
-- it ever met, which was also the first time it had ever been run: the unit
-- tests answer this query from a fixture, so nothing executed the SQL.
select 'sequence', sequencename, data_type::text from pg_sequences where schemaname = 'public'
`

// ── the CLI ─────────────────────────────────────────────────────────────────

/** Thrown after a refusal so the run stops even when `exit` is stubbed. */
export class ExitSignal extends Error {
  constructor(code, msg) { super(msg); this.name = 'ExitSignal'; this.code = code }
}

/** The whole CLI. `io` exists so the tests can drive it with a fake Management
 *  API and a fake process — there is no environment variable that redirects the
 *  real runner at another host, because a test seam that ships is a side door. */
export async function main(argv, env, io = {}) {
  const ROOT = io.root ?? process.cwd()
  const net = io.fetch ?? fetch
  const out = io.log ?? console.log
  const errOut = io.error ?? console.error
  const bail = io.exit ?? process.exit
  // NO SILENT DEFAULT. The first draft fell back to 'status' whenever argv[0]
  // was a flag — so `npm run migrate -- --project <ref>`, the exact line in
  // LANES/09-lws.md and in Lane 13's cutover steps, printed a status report and
  // applied NOTHING, successfully and silently. A cutover step that no-ops with
  // exit 0 is the worst kind of failure. Say the command, or get usage.
  const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : null
  const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? (argv[i + 1] ?? null) : null }
  const has = (n) => argv.includes(`--${n}`)
  const positional = argv.slice(cmd !== null && cmd === argv[0] ? 1 : 0)
    .filter((a, idx, arr) => !a.startsWith('--') && !(idx > 0 && /^--(project|token|only|why|dir)$/.test(arr[idx - 1])))

  // `bail` is process.exit in real life, so the throw below is unreachable. In
  // a test it records the code and the throw is what stops the run.
  const die = (msg, code = 1) => { errOut(`\n  ✗ ${msg}\n`); bail(code); throw new ExitSignal(code, msg) }

  const COMMANDS = ['status', 'verify', 'up', 'mark-applied', 'accept']
  if (cmd === null) {
    die(`no command given (expected: ${COMMANDS.join(', ')}).\n` +
        `    e.g.  npm run migrate -- up --project staging\n` +
        `    A bare \`--project <ref>\` used to be read as "status" and apply nothing.`)
  }
  if (!COMMANDS.includes(cmd)) die(`unknown command "${cmd}" (expected: ${COMMANDS.join(', ')})`)

  const sysmd = path.join(ROOT, 'SYSTEM.md')
  if (!fs.existsSync(sysmd)) die(`no SYSTEM.md in ${ROOT}. The runner takes its targets from the passport; a repo without one may not migrate anything.`)
  let PP
  try { PP = readPassport(fs.readFileSync(sysmd, 'utf8')) } catch (e) { die(e.message) }
  if (!PP.app) die('SYSTEM.md front-matter has no `app:` — the ledger is keyed by it')

  const REPO = PP.app
  const DIR = flag('dir') ?? PP.migrations_dir ?? 'sql/migrations'
  const alias = flag('project') ?? 'staging'
  const t = resolveTarget(PP, alias, cmd, env)
  if (t.error) die(t.error, t.code)
  const { ref, isProd } = t

  const token = flag('token') ?? env.SUPABASE_ACCESS_TOKEN ?? ''
  if (!token) die(`no Supabase management token.\n    Get one at https://supabase.com/dashboard/account/tokens (it starts sbp_)\n    then:  SUPABASE_ACCESS_TOKEN=sbp_… node scripts/migrate.mjs ${cmd}`, 2)

  const dryRun = has('dry-run')
  const only = flag('only')
  const why = flag('why')
  const whoami = env.USER ?? env.USERNAME ?? 'migrate.mjs'

  async function query(sql) {
    const res = await net(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    })
    const text = await res.text()
    if (!res.ok) {
      if (res.status === 401) die('the Supabase management token is not valid (401).\n    Get a fresh one at https://supabase.com/dashboard/account/tokens')
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 800)}`)
    }
    try { return JSON.parse(text) } catch { return text }
  }
  const rows = (r) => (Array.isArray(r) ? r : [])

  // ledger -------------------------------------------------------------------
  async function ensureLedger() {
    if (isProd && READ_ONLY_CMDS.has(cmd)) {
      // Lane 2 is read-only on production. Report the absence; never create it.
      return rows(await query(`select to_regclass('public.schema_migrations') is not null as ok`))[0]?.ok === true
    }
    await query(LEDGER_DDL)
    return true
  }
  const ledgerRows = () => query(`select name, checksum, applied_at, applied_by, source, note from public.schema_migrations where repo = ${quote(REPO)} order by name`).then(rows)

  // fingerprint --------------------------------------------------------------
  async function fingerprint() {
    const objects = {}
    for (const r of rows(await query(FINGERPRINT_SQL))) {
      objects[`${r.class}|${r.key}`] = crypto.createHash('sha256').update(String(r.def ?? '')).digest('hex').slice(0, 16)
    }
    const digest = crypto.createHash('sha256')
      .update(Object.keys(objects).sort().map(k => `${k}=${objects[k]}`).join('\n')).digest('hex')
    return { digest, objects, count: Object.keys(objects).length }
  }
  const lastFingerprint = () => query(`select id, taken_at, taken_by, digest, objects, reason from public.schema_fingerprint order by id desc limit 1`).then(r => rows(r)[0] ?? null)
  async function recordFingerprint(reason, note = null) {
    const fp = await fingerprint()
    await query(
      `insert into public.schema_fingerprint (digest, objects, reason, note) values (${quote(fp.digest)}, ${quote(JSON.stringify(fp.objects))}::jsonb, ${quote(reason)}, ${quote(note)});` +
      `delete from public.schema_fingerprint where id < (select max(id) - 19 from public.schema_fingerprint);`)
    return fp
  }

  // the shared-database lock -------------------------------------------------
  // Claim it or stop. The version this replaces wrote to a `state` column that
  // does not exist on coordination_lock, caught the error, printed a warning
  // and carried on — a lock that had never once been able to hold. A lock that
  // fails open is not a lock; it is a sentence about a lock.
  const LOCK_TAG = `migrate.mjs ${REPO} ${new Date().toISOString()}`
  async function claimLock() {
    if (!SHARED_REFS.has(ref)) return false
    const got = rows(await query(
      `update public.coordination_lock
          set holder = ${quote(LOCK_TAG)}, claimed_at = now(), updated_at = now(), note = ${quote(`migrating ${REPO}`)}
        where resource = ${quote(LOCK_RESOURCE)} and holder is null
        returning holder;`))
    if (got.length) return true
    const cur = rows(await query(`select holder, note, claimed_at from public.coordination_lock where resource = ${quote(LOCK_RESOURCE)}`))
    if (!cur.length) {
      die(`the ${LOCK_RESOURCE} coordination lock row does not exist on ${ref}.\n` +
          `    The runner will not migrate the shared database without a lock to claim.\n` +
          `    Create it:  insert into public.coordination_lock (resource, note) values ('${LOCK_RESOURCE}', 'FREE');`)
    }
    const age = cur[0].claimed_at ? Math.round((Date.now() - new Date(cur[0].claimed_at)) / 60000) : null
    die(`the ${LOCK_RESOURCE} lock is held by "${cur[0].holder}"${age !== null ? ` (claimed ${age} min ago)` : ''}.\n` +
        `    Somebody else is running SQL against this database. Wait for them.` +
        (age !== null && age > LOCK_STALE_MINUTES
          ? `\n    It is older than ${LOCK_STALE_MINUTES} minutes, so it may be stale — but clearing another session's lock is a human decision, not this script's.`
          : ''))
  }
  async function releaseLock(held) {
    if (!held) return
    try {
      await query(`update public.coordination_lock set holder = null, note = 'FREE', updated_at = now() where resource = ${quote(LOCK_RESOURCE)} and holder = ${quote(LOCK_TAG)};`)
    } catch (e) {
      errOut(`\n  ! COULD NOT RELEASE THE ${LOCK_RESOURCE} LOCK: ${e.message}\n` +
                    `    Clear it by hand or every later migration blocks:\n` +
                    `    update public.coordination_lock set holder = null, note = 'FREE' where resource = '${LOCK_RESOURCE}';\n`)
    }
  }

  // one inspection, used by status, verify and up ----------------------------
  async function inspect() {
    const files = discoverIn(ROOT, DIR)
    const present = await ensureLedger()
    const c = classify(files, present ? await ledgerRows() : [])
    let shape = null
    if (present) {
      const last = await lastFingerprint()
      const live = await fingerprint()
      shape = last ? { last, live, ...diffObjects(last.objects, live.objects) } : { last: null, live, added: [], removed: [], changed: [] }
    }
    return { files, present, ...c, shape }
  }

  // commands ------------------------------------------------------------------
  async function status(quiet = false) {
    const s = await inspect()
    const say = (...a) => { if (!quiet) out(...a) }
    say(`\n  ${REPO} → ${alias} (${ref})${isProd ? '  [PRODUCTION — read only]' : ''}`)
    if (!s.present) { say(`  no schema_migrations on this project yet. Lane 13 creates it at cutover.\n`); return s }
    say(`  ${s.applied.length} applied · ${s.pending.length} pending · ${s.edited.length} edited-after-applying · ${s.orphans.length} applied-but-not-in-git\n`)
    for (const f of s.pending) say(`  PENDING   ${DIR}/${f.name}`)
    for (const f of s.edited) say(`  EDITED    ${DIR}/${f.name}  ← already applied ${String(f.row.applied_at).slice(0, 10)}; the file has changed since`)
    for (const r of s.orphans) say(`  ORPHAN    ${r.name}  ← recorded applied ${String(r.applied_at).slice(0, 10)}, no such file in git`)

    const sh = s.shape
    if (sh && !sh.last) say(`\n  no schema fingerprint recorded yet — run \`migrate accept --why "…"\` to set the expected shape.`)
    else if (sh) {
      const n = sh.added.length + sh.removed.length + sh.changed.length
      if (!n) say(`\n  shape matches the fingerprint taken ${String(sh.last.taken_at).slice(0, 19).replace('T', ' ')} (${Object.keys(sh.live.objects).length} objects).`)
      else {
        say(`\n  ⚠ SHAPE CHANGED SINCE THE LAST RECORDED FINGERPRINT — ${n} object(s), and no migration in this repo accounts for them.`)
        say(`    Fingerprint taken ${String(sh.last.taken_at).slice(0, 19).replace('T', ' ')} by ${sh.last.taken_by} (${sh.last.reason ?? 'no reason recorded'}).`)
        for (const [mark, list] of [['+', sh.added], ['-', sh.removed], ['~', sh.changed]]) list.slice(0, 15).forEach(k => say(`    ${mark} ${k.replace('|', ' ')}`))
        say(`    Either it was pasted in by hand, or another repo migrated this shared database.`)
        say(`    Reconcile it, then \`migrate accept --why "…"\` to record the new expected shape.`)
      }
    }
    if (!quiet) out('')
    return s
  }

  /** The gate. Anything wrong exits non-zero, so this is what CI and the
   *  nightly cron run. One line when everything is true. */
  async function verify() {
    const s = await status(true)
    const problems = []
    if (!s.present) problems.push('no schema_migrations table on this project')
    if (s.pending.length) problems.push(`${s.pending.length} migration(s) in git are not applied: ${s.pending.map(f => f.name).join(', ')}`)
    if (s.edited.length) problems.push(`${s.edited.length} applied migration(s) have been edited since: ${s.edited.map(f => f.name).join(', ')}`)
    if (s.orphans.length) problems.push(`${s.orphans.length} migration(s) recorded applied with no file in git: ${s.orphans.map(r => r.name).join(', ')}`)
    if (s.shape && !s.shape.last) problems.push('no schema fingerprint has ever been recorded')
    else if (s.shape) {
      const n = s.shape.added.length + s.shape.removed.length + s.shape.changed.length
      if (n) problems.push(`${n} schema object(s) changed outside the runner: ${[...s.shape.added, ...s.shape.removed, ...s.shape.changed].slice(0, 10).map(k => k.replace('|', ' ')).join('; ')}`)
    }
    if (!problems.length) { out(`  ✓ ${REPO} → ${alias} (${ref}): schema in git matches the database.`); return }
    errOut(`\n  ✗ ${REPO} → ${alias} (${ref})`)
    for (const p of problems) errOut(`    · ${p}`)
    errOut('')
    bail(1); throw new ExitSignal(1, 'verify failed')
  }

  async function up() {
    const s = await status()
    if (s.edited.length) die(`${s.edited.length} applied migration(s) have been edited since they ran.\n    The database ran the OLD text, so the file no longer describes reality.\n    Write a NEW migration. Never edit an applied one.`)
    if (s.orphans.length) die(`${s.orphans.length} migration(s) are recorded applied with no file in git:\n` +
      s.orphans.map(r => `      ${r.name} (applied ${String(r.applied_at).slice(0, 10)} by ${r.applied_by})`).join('\n') +
      `\n    A live database change with no code is exactly the 11/08 failure. Restore the file, or delete the ledger row deliberately and say which in the commit.`)

    let todo = s.pending
    if (only) {
      // Exact filename, or the NNN- number. The first draft used endsWith(), so
      // `--only .sql` quietly selected every pending migration.
      const num = /^\d{3}$/.test(String(only)) ? `${only}-` : null
      todo = s.pending.filter(f => f.name === only || (num !== null && f.name.startsWith(num)))
      if (!todo.length) die(s.done.has(only) ? `${only} has already been applied.` : `${only} is not a pending migration.`)
    }
    if (!todo.length) { out('  Nothing to apply.\n'); return }
    if (dryRun) { out(`  --dry-run: would apply ${todo.length} migration(s), changing nothing.\n`); return }

    const held = await claimLock()
    try {
      let fp = null
      for (const f of todo) {
        const ledger = `insert into public.schema_migrations (repo, name, checksum, applied_by, source, note) values (${quote(REPO)}, ${quote(f.name)}, ${quote(f.checksum)}, ${quote(whoami)}, 'runner', ${quote(why)});`
        if (isUntransactioned(f.body)) {
          // `create index concurrently` cannot run inside a transaction, so this
          // one genuinely is two steps and genuinely can tear. Say so out loud
          // rather than letting it look like the atomic path.
          out(`  ${f.name} is marked no-transaction — it and its ledger row are applied separately`)
          await query(f.body)
          await query(ledger)
        } else {
          // ONE round trip: the migration and its ledger row commit together or
          // not at all. Two separate queries meant the migration could COMMIT
          // and the ledger insert then fail — dropped connection, expired token,
          // Ctrl-C — leaving a changed database with no record of the change, so
          // the next `up` ran it again. 002 happens to be idempotent and would
          // survive that. Nothing else will.
          await query(transactional(`${f.body}\n${ledger}`))
        }
        // Fingerprint INSIDE the loop. Taken once at the end, a throw on
        // migration 3 of 5 left 1-2 applied and recorded with no fingerprint —
        // so the next `status` shouted "SHAPE CHANGED AND NO MIGRATION ACCOUNTS
        // FOR IT" about objects the runner had itself just created. An alarm
        // that cries wolf about its own work is an alarm somebody switches off.
        fp = await recordFingerprint(`up: ${f.name} by ${REPO}`, why)
        out(`  applied ${f.name}`)
      }
      out(`\n  ${todo.length} migration(s) applied to ${alias}. Fingerprint ${fp.digest.slice(0, 12)} over ${fp.count} objects.\n`)
    } finally {
      await releaseLock(held)
    }
  }

  /** Record a file as applied WITHOUT running it — for history that went in by
   *  hand before the runner existed. Every one of these is a claim about the
   *  past and must carry --why, so `select note from schema_migrations where
   *  source = 'reconciled'` reads as the reconciliation record it is. */
  async function markApplied() {
    const name = positional[0]
    if (!name) die('mark-applied needs a file name: node scripts/migrate.mjs mark-applied 001-thing.sql --why "…"')
    if (!why) die('mark-applied needs --why "…" — a row asserting something already ran is a claim about the past, and an unexplained one is how this suite got here.')
    const file = discoverIn(ROOT, DIR).find(f => f.name === path.basename(name))
    if (!file) die(`${name} is not in ${DIR}`)
    await ensureLedger()
    await query(`insert into public.schema_migrations (repo, name, checksum, applied_by, source, note) values (${quote(REPO)}, ${quote(file.name)}, ${quote(file.checksum)}, ${quote(whoami)}, 'reconciled', ${quote(why)}) on conflict (repo, name) do update set checksum = excluded.checksum, source = 'reconciled', note = excluded.note;`)
    out(`  recorded ${file.name} as already applied on ${alias}: ${why}\n`)
  }

  /** Say "the database is the shape it should be" — after a reconciliation, or
   *  after another repo legitimately migrated the same shared database. */
  async function accept() {
    if (!why) die('accept needs --why "…" — it silences a drift alarm, so the reason belongs in the row.')
    await ensureLedger()
    const before = await lastFingerprint()
    const fp = await recordFingerprint('accept', why)
    if (before) {
      const d = diffObjects(before.objects, fp.objects)
      out(`  accepted ${d.added.length} added, ${d.removed.length} removed, ${d.changed.length} changed object(s).`)
    }
    out(`  fingerprint ${fp.digest.slice(0, 12)} over ${fp.count} objects recorded on ${alias}: ${why}\n`)
  }

  await ({ status, verify, up, 'mark-applied': markApplied, accept })[cmd]()
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  main(process.argv.slice(2), process.env).catch(e => {
    // A refusal has already printed its reason and exited; anything else is a
    // real crash and needs saying out loud.
    if (e instanceof ExitSignal) return
    console.error(`\n  ✗ ${e instanceof Error ? e.message : String(e)}\n`)
    process.exit(1)
  })
}
