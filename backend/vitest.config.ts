import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  // Nest leans on decorator metadata, which esbuild does not emit. swc does.
  plugins: [swc.vite({ module: { type: 'es6' } })],
})
