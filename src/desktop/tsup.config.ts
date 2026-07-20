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
    entry: { main: 'main/index.ts' },
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
