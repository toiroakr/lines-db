import { defineConfig } from 'tsdown';
import { loculusPlugin } from '@loculus/rolldown';

export default defineConfig([
  // CLI build (ESM only)
  {
    entry: ['src/cli.ts'],
    plugins: [loculusPlugin()],
    external: ['@lines-db/studio'],
    format: ['esm'],
    platform: 'node',
    target: 'node22',
    clean: true,
    shims: true,
    outDir: 'bin',
    dts: false,
    treeshake: true,
  },
  // Library build (ESM only)
  {
    entry: ['src/index.ts', 'src/internal.ts'],
    format: ['esm'],
    platform: 'node',
    target: 'node22',
    outDir: 'dist',
    dts: true,
    treeshake: true,
  },
]);
