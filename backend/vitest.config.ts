import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Integration tests share one database; parallel files would fight.
    fileParallelism: false,
    /**
     * A ratchet, not a target. Set just below what the suite achieves today so
     * it fails when coverage drops rather than demanding new work to go green.
     * Raise it deliberately; do not lower it to make a build pass.
     */
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        // Bootstrap: exercised by running the process, not by a unit test.
        'src/main.ts',
        // Type-only; there is no runtime code to cover.
        'src/ai/provider.ts',
        'src/database/schema/**',
      ],
      thresholds: { lines: 90, branches: 85, functions: 80, statements: 90 },
    },
  },
  // Nest leans on decorator metadata, which esbuild does not emit. swc does.
  plugins: [swc.vite({ module: { type: 'es6' } })],
})
