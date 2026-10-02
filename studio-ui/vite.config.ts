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
      '/api': { target: 'http://127.0.0.1:4848', changeOrigin: false },
    },
  },
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'] },
});
