#!/usr/bin/env node
// scripts/whichdb.mjs
//
// SINGLE SOURCE OF TRUTH for "which Supabase project is this repo wired to?"
//
// Reads .env.local in the current working directory, decodes the JWTs,
// and prints the correct Supabase Dashboard URLs to use for THIS repo.
// Flags a CRITICAL warning if the URL's project ref doesn't match the
// JWT's ref claim (which means the keys are for a different project
// than the URL — keys won't validate properly and weird things happen).
//
// USAGE:
//   node scripts/whichdb.mjs
//
// No npm dependencies — works on any Node 18+.

import { readFileSync, existsSync } from 'node:fs'
import { resolve, basename } from 'node:path'

const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

function decodeJwt(jwt) {
  if (!jwt) return null
  const parts = jwt.split('.')
  if (parts.length < 2) return null
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(Buffer.from(padded, 'base64').toString())
  } catch {
    return null
  }
}

function parseEnv(text) {
  return Object.fromEntries(
    text.split('\n')
      .map(l => l.match(/^([A-Z_]+)=(.+)$/))
      .filter(Boolean)
      .map(m => [m[1], m[2].trim()])
  )
}

function refFromUrl(url) {
  return url?.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? null
}

const envPath = resolve(process.cwd(), '.env.local')
if (!existsSync(envPath)) {
  console.error(`${RED}No .env.local found in ${process.cwd()}${RESET}`)
  console.error('Run this script from the repo root.')
  process.exit(1)
}

const env = parseEnv(readFileSync(envPath, 'utf8'))
const url = env.NEXT_PUBLIC_SUPABASE_URL
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const svc = env.SUPABASE_SERVICE_ROLE_KEY

if (!url) {
  console.error(`${RED}NEXT_PUBLIC_SUPABASE_URL missing from .env.local${RESET}`)
  process.exit(1)
}

const urlRef = refFromUrl(url)
const anonClaims = decodeJwt(anon)
const svcClaims = decodeJwt(svc)
const anonRef = anonClaims?.ref ?? null
const svcRef = svcClaims?.ref ?? null

const repoName = basename(process.cwd())
console.log(`${BOLD}Supabase project for ${repoName}${RESET}`)
console.log(`${DIM}(read from ${envPath})${RESET}`)
console.log()
console.log(`  URL:         ${url}`)
console.log(`  Project ref: ${urlRef ?? '(could not parse from URL)'}`)
console.log()

const fail = (msg) => console.log(`  ${RED}${BOLD}✗ ${msg}${RESET}`)
const ok   = (msg) => console.log(`  ${GREEN}✓ ${msg}${RESET}`)

if (anonClaims) {
  if (anonRef === urlRef) ok(`Anon key ref matches URL (${anonRef})`)
  else fail(`Anon key ref is ${anonRef}, but URL is ${urlRef} — KEYS ARE FOR A DIFFERENT PROJECT`)
} else if (anon?.startsWith('sb_publishable_')) {
  ok('Anon key is a new-style sb_publishable_ key — no project ref embedded, URL is authoritative')
} else {
  fail('Anon key missing or not a recognised key')
}

if (svcClaims) {
  if (svcRef === urlRef) ok(`Service role key ref matches URL (${svcRef})`)
  else fail(`Service role key ref is ${svcRef}, but URL is ${urlRef} — KEYS ARE FOR A DIFFERENT PROJECT`)
} else if (svc?.startsWith('sb_secret_')) {
  ok('Service key is a new-style sb_secret_ key — no project ref embedded, URL is authoritative')
} else {
  fail('Service role key missing or not a recognised key')
}

console.log()
console.log(`${BOLD}Use these URLs for this repo:${RESET}`)
console.log(`  SQL Editor:  https://supabase.com/dashboard/project/${urlRef}/sql/new`)
console.log(`  Table view:  https://supabase.com/dashboard/project/${urlRef}/editor`)
console.log(`  Auth users:  https://supabase.com/dashboard/project/${urlRef}/auth/users`)
console.log(`  Policies:    https://supabase.com/dashboard/project/${urlRef}/auth/policies`)
console.log(`  API keys:    https://supabase.com/dashboard/project/${urlRef}/settings/api`)
console.log(`  DB settings: https://supabase.com/dashboard/project/${urlRef}/settings/database`)
console.log()

if ((anonRef && anonRef !== urlRef) || (svcRef && svcRef !== urlRef)) {
  process.exit(1)
}
