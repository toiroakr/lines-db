import { defineConfig } from 'tsdown';

export default defineConfig([
  // CLI build (ESM only)
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    platform: 'node',
    target: 'node18',
    clean: true,
    shims: true,
    outDir: 'bin',
    dts: false,
    treeshake: true,
  },
  // Library build (ESM + CJS)
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    platform: 'node',
    target: 'node18',
    outDir: 'dist',
    dts: true,
    treeshake: true,
  },
]);
