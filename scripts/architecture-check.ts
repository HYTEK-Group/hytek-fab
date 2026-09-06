// HYTEK architecture check — static scan, fails on side doors not declared in SYSTEM.md.
// CANONICAL COPY. Every app repo carries a byte-identical copy at scripts/architecture-check.ts.
// Never edit an app-repo copy: change this file, then re-copy (Lane 0 §9).
// Usage: npx tsx tool/architecture-check.ts [--emit] [--root <dir>]
import fs from 'node:fs'; import path from 'node:path'

const ROOT = path.resolve(process.argv.includes('--root') ? process.argv[process.argv.indexOf('--root') + 1] : '.')
const EMIT = process.argv.includes('--emit')
const SKIP_DIR = /^(node_modules|\.next|\.git|\.worktrees|\.claude|dist|out|coverage|public|reports|training|__fixtures__)$/
const CODE = /\.(ts|tsx|js|mjs|cjs|ps1|py)$/
const TEST = /(\.test\.|\.spec\.|__tests__|\/tests?\/|vitest\.|architecture-check)/
const PRIV = /\b([A-Z0-9_]*(SERVICE_ROLE|SERVICE_KEY|HUBSPOT_|XERO_|PROV_)[A-Z0-9_]*)\b/g
const OTHER_HOSTS = ['hub.hytekframing.com.au','detailing.hytekframing.com.au','dispatch.hytekframing.com.au','install.hytekframing.com.au',
  ...['hub','detailing','fab','install','invoicing','purchasing','lws','planner','planner-hb','capacity','job-register'].flatMap(a => [`hytek-${a}.vercel.app`, `hytek-${a}-staging.vercel.app`]),
  'api.hubapi.com','api.xero.com','identity.xero.com','app.asana.com','graph.microsoft.com','login.microsoftonline.com','api.resend.com','hooks.slack.com','api.supabase.com','api.vercel.com','api.anthropic.com','api.github.com']
const WRITE_VERBS = new Set(['insert','update','upsert','delete'])

type Passport = { app: string; supabase: { project_refs: string[]; env: string[] }; tables: { owns: string[]; rpcs: string[] }; hosts: { approved: string[] }; env: { privileged: string[] }; crons: string[]; exemptions: { path: string; reason: string; until: string }[] }

// Minimal YAML subset: `key:` nesting by indent, `- item`, `- { k: v, k: v }`, `[a, b]`, scalars.
// Enough for the passport schema; no anchors, no multi-line strings.
function parseFrontMatter(md: string): Passport {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/); if (!m) throw new Error('SYSTEM.md has no YAML front-matter')
  const lines = m[1].split(/\r?\n/).map(l => l.replace(/\s+#.*$/, '')).filter(l => l.trim())
  const root: any = {}; const stack: { indent: number; obj: any }[] = [{ indent: -1, obj: root }]
  const scalar = (s: string) => s.trim().replace(/^["']|["']$/g, '')
  const list = (s: string) => s.trim().replace(/^\[|\]$/g, '').split(',').map(scalar).filter(Boolean)
  const inlineObj = (s: string) => Object.fromEntries(s.trim().replace(/^\{|\}$/g, '').split(',').map(kv => { const i = kv.indexOf(':'); return [scalar(kv.slice(0, i)), scalar(kv.slice(i + 1))] }))
  for (const raw of lines) {
    const indent = raw.search(/\S/); const line = raw.trim()
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop()
    const parent = stack[stack.length - 1].obj
    if (line.startsWith('- ')) { const v = line.slice(2); (parent as any[]).push(v.startsWith('{') ? inlineObj(v) : scalar(v)); continue }
    const i = line.indexOf(':'); const key = line.slice(0, i).trim(); const rest = line.slice(i + 1).trim()
    if (rest === '') { const child: any = /^(exemptions|project_refs|env|owns|reads|rpcs|approved|privileged|crons|out|in)$/.test(key) ? [] : {}; parent[key] = child; stack.push({ indent, obj: child }) }
    else if (rest.startsWith('{')) throw new Error(`SYSTEM.md: "${key}" uses inline-object form; write it expanded (key on its own line, children indented) — see tool/passport-schema.md`)
    else parent[key] = rest.startsWith('[') ? list(rest) : scalar(rest)
  }
  for (const k of ['supabase','tables','hosts','env']) root[k] ??= {}
  root.crons ??= []; root.exemptions ??= []; root.supabase.project_refs ??= []; root.supabase.env ??= []
  root.tables.owns ??= []; root.tables.rpcs ??= []; root.hosts.approved ??= []; root.env.privileged ??= []
  return root as Passport
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) walk(path.join(dir, e.name), out); continue }
    const f = path.join(dir, e.name); if (CODE.test(e.name) && !TEST.test(f.replace(/\\/g, '/'))) out.push(f)
  }
  return out
}

// Follow a PostgREST chain from `.from('t')` and return the verbs called on it (multi-line aware, paren-balanced).
function chainVerbs(src: string, from: number): string[] {
  const verbs: string[] = []; let i = from
  for (;;) {
    const m = /^\s*\.\s*([A-Za-z_]+)\s*\(/.exec(src.slice(i)); if (!m) return verbs
    verbs.push(m[1]); i += m[0].length; let depth = 1
    while (i < src.length && depth) { const c = src[i]; if (c === '(') depth++; else if (c === ')') depth--; else if (c === '`' || c === '"' || c === "'") { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++ } } i++ }
  }
}

type Found = { writes: Map<string, string[]>; rpcs: Map<string, string[]>; hosts: Map<string, string[]>; refs: Map<string, string[]>; priv: Map<string, string[]>; clientEnv: Map<string, string[]>; cronRoutes: { route: string; file: string }[] }
function scan(files: string[]): Found {
  const add = (m: Map<string, string[]>, k: string, f: string) => m.set(k, [...(m.get(k) ?? []), f])
  const F: Found = { writes: new Map(), rpcs: new Map(), hosts: new Map(), refs: new Map(), priv: new Map(), clientEnv: new Map(), cronRoutes: [] }
  for (const f of files) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/'); const src = fs.readFileSync(f, 'utf8')
    for (const m of src.matchAll(/\.from\(\s*['"`]([a-z0-9_.]+)['"`]\s*\)/g)) { const verbs = chainVerbs(src, m.index! + m[0].length); for (const v of verbs) if (WRITE_VERBS.has(v)) add(F.writes, m[1], `${rel} (${v})`) }
    for (const m of src.matchAll(/\.rpc\(\s*['"`]([a-z0-9_]+)['"`]/g)) add(F.rpcs, m[1], rel)
    for (const m of src.matchAll(/\/rest\/v1\/(rpc\/)?([a-z0-9_]+)/g)) add(m[1] ? F.rpcs : F.writes, m[2], `${rel} (raw PostgREST)`)
    for (const m of src.matchAll(/\b([a-z]{20})\.supabase\.co\b/g)) add(F.refs, m[1], rel)
    for (const h of OTHER_HOSTS) if (src.includes(h)) add(F.hosts, h, rel)
    for (const m of src.matchAll(PRIV)) add(F.priv, m[1], rel)
    if (/\b(createClient|createBrowserClient|createServerClient)\s*\(/.test(src)) for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)|\$env:([A-Z0-9_]+)|os\.environ\[['"]([A-Z0-9_]+)/g)) { const n = m[1] ?? m[2] ?? m[3]; if (/SUPABASE|_URL$|_KEY$|_REF$/.test(n)) add(F.clientEnv, n, rel) }
    const cm = rel.match(/^(?:src\/)?app\/(api\/(?:cron\/.*|.*\/cron\/.*))\/route\.(ts|js)$/); if (cm) F.cronRoutes.push({ route: '/' + cm[1], file: rel })
  }
  return F
}

function main() {
  const vercel = fs.existsSync(path.join(ROOT, 'vercel.json')) ? (JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')).crons ?? []).map((c: any) => c.path) : []
  const F = scan(walk(ROOT))
  // --emit bootstraps a passport, so it must not require one to already exist.
  if (EMIT) { console.log(JSON.stringify({ supabase: { project_refs: [...F.refs.keys()], env: [...F.clientEnv.keys()] }, tables: { owns: [...F.writes.keys()].sort(), rpcs: [...F.rpcs.keys()].sort() }, hosts: { approved: [...F.hosts.keys()] }, env: { privileged: [...F.priv.keys()].sort() }, crons: [...new Set([...vercel, ...F.cronRoutes.map(c => c.route)])].sort() }, null, 2)); return }
  const passport = parseFrontMatter(fs.readFileSync(path.join(ROOT, 'SYSTEM.md'), 'utf8'))
  const today = new Date().toISOString().slice(0, 10)
  const exempt = (file: string) => passport.exemptions.some(e => file.startsWith(e.path) && e.until >= today)
  const fails: string[] = []
  const check = (m: Map<string, string[]>, allowed: string[], rule: string) => { for (const [k, files] of m) { const live = files.filter(f => !exempt(f.split(' ')[0])); if (live.length && !allowed.includes(k)) fails.push(`${rule}: "${k}" not in SYSTEM.md — ${live.slice(0, 3).join(', ')}${live.length > 3 ? ` (+${live.length - 3})` : ''}`) } }
  check(F.writes, passport.tables.owns, 'WRITE to table not owned')
  check(F.rpcs, passport.tables.rpcs, 'RPC not declared')
  check(F.hosts, passport.hosts.approved, 'FETCH to host not approved')
  check(F.refs, passport.supabase.project_refs, 'Supabase project ref not declared')
  check(F.clientEnv, passport.supabase.env, 'Supabase client built from undeclared env')
  check(F.priv, passport.env.privileged, 'privileged env name not declared')
  for (const { route: r, file } of F.cronRoutes) { if (exempt(file)) continue; if (!vercel.includes(r)) fails.push(`CRON route ${r} not in vercel.json`); if (!passport.crons.includes(r)) fails.push(`CRON route ${r} not in SYSTEM.md crons`) }
  for (const c of vercel) if (!passport.crons.includes(c)) fails.push(`vercel.json cron ${c} not in SYSTEM.md crons`)
  for (const e of passport.exemptions) if (e.until < today) fails.push(`EXEMPTION expired: ${e.path} (${e.reason}, until ${e.until})`)
  if (fails.length) { console.error(`architecture check FAILED (${fails.length}):\n  ` + fails.join('\n  ')); process.exit(1) }
  console.log(`architecture check OK — ${passport.app}: ${F.writes.size} write targets, ${F.hosts.size} hosts, ${F.priv.size} privileged env names, ${F.cronRoutes.length} cron routes`)
}
main()
