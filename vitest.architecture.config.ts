import { defineConfig } from 'vitest/config'

// Separate config on purpose: the repo's main vitest.config.ts scopes `include`
// to its own test folder, and that must not be widened. This one collects the
// root architecture.test.ts and nothing else.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['architecture.test.ts'],
    testTimeout: 60000,
  },
})
