// THE GUARD. fab must never write a Hub-owned table again.
//
// Why this exists when `npm run test:architecture` already catches it: the
// architecture check compares detected write targets against SYSTEM.md's
// `tables.owns`. Someone re-adding the write AND the passport line together
// passes it — the passport is the thing being edited, so it cannot also be the
// thing doing the enforcing in that case. This test names the tables, so
// re-adding the door costs deleting a test that says in English why it is
// there. That is the two-places-at-once pattern Lane 3 used for the outbox
// vocabulary (a CHECK constraint plus a test that parses the SQL).
//
// hytek-brain/findings/2026-09-05-architecture-review/WHY-IT-DRIFTED.md: every
// rule enforced by a document drifted; every rule enforced by a constraint,
// a revoked grant or deleted code held.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Tables whose CREATE lives in hytek-hub and whose reader is the Hub
 * (lib/flow/signals/job-state.ts, lib/flow/buffer-snapshot.ts, lib/flow/fab-weeks.ts).
 * fab reports these facts as events; the Hub does the writing.
 */
const HUB_OWNED = ['flow_fab_entries', 'flow_fab_progress', 'flow_events', 'flow_stages', 'jobs']

const SRC = join(__dirname, '..', '..')

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue
      yield* sourceFiles(full)
    } else if (/\.tsx?$/.test(entry)) {
      yield full
    }
  }
}

describe('fab never writes a Hub-owned table', () => {
  const files = [...sourceFiles(SRC)]

  it('finds source files to check (the test is not vacuously passing)', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  for (const table of HUB_OWNED) {
    it(`no insert/update/upsert/delete on ${table}`, () => {
      const offenders: string[] = []
      for (const file of files) {
        const text = readFileSync(file, 'utf8')
        // .from('<table>') anywhere on a chain that also carries a mutation.
        // Deliberately crude and deliberately per-statement: a read of `jobs`
        // is legitimate and must keep working, a write to it never is.
        for (const raw of text.split(/\n(?=\s*(?:const|let|await|return|if|for)\b)/)) {
          if (!raw.includes(`.from('${table}')`)) continue
          if (/\.(insert|update|upsert|delete)\s*\(/.test(raw)) {
            offenders.push(`${file.slice(SRC.length + 1)} — ${raw.trim().split('\n')[0]}`)
          }
        }
      }
      expect(offenders, `fab wrote a Hub-owned table:\n${offenders.join('\n')}`).toEqual([])
    })
  }
})
