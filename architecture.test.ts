// Runs the HYTEK architecture check (scripts/architecture-check.ts) as a test so
// it gates a PR through the normal vitest path. It is deliberately NOT collected
// by the repo's main vitest.config.ts — see vitest.architecture.config.ts.
//
// tsx is launched through node (process.execPath) rather than `npx`: on Windows
// npx is a .cmd, which execFileSync cannot launch, and the checkout path contains
// spaces.
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { test } from 'vitest'

test('architecture check', () => {
  const repo = path.resolve(import.meta.dirname)
  execFileSync(
    process.execPath,
    [path.join(repo, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(repo, 'scripts', 'architecture-check.ts')],
    { stdio: 'inherit', cwd: repo },
  )
})
