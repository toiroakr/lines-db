import { defineConfig } from 'tsdown';

export default defineConfig([
  // CLI build (ESM only, fully bundled)
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    platform: 'node',
    target: 'node22',
    clean: true,
    shims: true,
    outDir: 'bin',
    dts: false,
    treeshake: true,
    deps: {
      alwaysBundle: ['zod', 'politty'],
      onlyBundle: false,
    },
  },
  // Library build (ESM only)
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    platform: 'node',
    target: 'node22',
    outDir: 'dist',
    dts: true,
    treeshake: true,
  },
]);
