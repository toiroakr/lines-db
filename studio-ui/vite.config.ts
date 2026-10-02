import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

// The studio serves the build from lib/studio, so the CLI ships it without a runtime dependency
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { outDir: '../lib/studio', emptyOutDir: true },
  server: {
    proxy: {
      // Not passing the browser's Host and Origin through: the studio server refuses requests not addressed to it
      '/api': { target: 'http://127.0.0.1:4848', changeOrigin: true, headers: { origin: 'http://127.0.0.1:4848' } },
    },
  },
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'] },
});
