import { defineConfig } from 'tsup'

const shared = {
  platform: 'node' as const,
  target: 'node22',
  outDir: 'dist',
  sourcemap: true,
  splitting: false,
  external: ['electron', 'node:sqlite'],
}

export default defineConfig([
  {
    ...shared,
    // The in-process daemon loads usage-worker by path, beside main.js.
    entry: { main: 'main/index.ts', 'usage-worker': '../web/usage-worker.ts' },
    format: ['esm'],
    clean: true,
  },
  {
    ...shared,
    entry: { preload: 'preload.ts' },
    format: ['cjs'],
    clean: false,
  },
])
