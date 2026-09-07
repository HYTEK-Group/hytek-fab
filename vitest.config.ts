import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // scripts/ is included because the on-site bridge's pure logic lives there
    // and a test that never runs is not a test. hytek-lws already does this.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    coverage: { reporter: ['text'] },
  },
})
