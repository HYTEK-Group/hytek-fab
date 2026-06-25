// Print the Supabase project this repo is configured to talk to.
// RUN THIS BEFORE ANY SQL:  node scripts/whichdb.mjs
// Confirms the project ref is gqtikzguvhukpujyxkez (the shared operations DB)
// before you paste a migration into the Supabase SQL editor.

import { readFileSync } from 'node:fs'

function fromEnvFile(path) {
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^\s*NEXT_PUBLIC_SUPABASE_URL\s*=\s*(.+)\s*$/)
      if (m) return m[1].replace(/^["']|["']$/g, '').trim()
    }
  } catch {
    /* no env file */
  }
  return ''
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || fromEnvFile('.env.local') || fromEnvFile('.env')
let ref = '(none)'
try {
  if (url) ref = new URL(url).host.split('.')[0]
} catch {
  /* malformed url */
}

const EXPECTED = 'gqtikzguvhukpujyxkez'
console.log('Supabase URL :', url || '(unset)')
console.log('Project ref  :', ref)
if (ref === EXPECTED) {
  console.log('OK — this is the shared gqtikz operations DB. Safe target for fab SQL.')
  process.exit(0)
} else {
  console.log(`WARNING — this is NOT ${EXPECTED}. Do NOT paste fab SQL here.`)
  process.exit(1)
}
