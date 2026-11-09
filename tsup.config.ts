import { defineConfig } from 'tsup'

export default defineConfig({
  // usage-worker is loaded by path at runtime (see src/web/usage-runner.ts),
  // so it must keep its name and sit beside the chunks.
  entry: { cli: 'src/cli.tsx', 'usage-worker': 'src/web/usage-worker.ts' },
  format: ['esm'],
  target: 'node20',
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
  external: [
    'ink',
    'react',
    '@zenobius/ink-mouse',
    'node:sqlite',
  ],
  esbuildOptions(options) {
    options.jsx = 'automatic'
  },
})
