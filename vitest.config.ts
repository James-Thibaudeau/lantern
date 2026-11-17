import { defineConfig } from 'vitest/config'

// Kept separate from vite.config.ts so tests don't load the TanStack Start plugins.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
})
