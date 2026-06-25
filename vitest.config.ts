import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
  test: {
    // jsdom by default so React hook tests (use-form-draft) get a real
    // window + localStorage. Existing tests that hit idb-keyval still work
    // because fake-indexeddb in the setup file installs IndexedDB globally
    // regardless of environment.
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts'],
    coverage: { reporter: ['text'] },
  },
})
