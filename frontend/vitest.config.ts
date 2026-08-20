import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(import.meta.dirname, './src') },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts', 'src/middleware.ts', 'src/app/**/*.tsx'],
      exclude: ['src/**/*.test.*', 'src/app/layout.tsx', 'src/app/page.tsx'],
      // Raised once the login form was covered: it was the way into the
      // application and had no tests at all.
      thresholds: { lines: 90, branches: 88, functions: 85, statements: 90 },
    },
  },
})
