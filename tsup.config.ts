import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli.tsx'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
  external: ['ink', 'react'],
  esbuildOptions(options) {
    options.jsx = 'automatic'
  },
})
