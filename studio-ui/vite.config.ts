import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vitest/config';

const STUDIO = 'http://127.0.0.1:4848';

/** Hand the dev page the token the studio gives the page it serves, as that page is this one in development */
const studioToken = (): Plugin => ({
  name: 'lines-db-studio-token',
  apply: 'serve',
  async transformIndexHtml(html) {
    const page = await fetch(`${STUDIO}/`).then(
      (response) => response.text(),
      () => '',
    );
    const meta = /<meta name="studio-token" content="[^"]*">/.exec(page)?.[0];
    return meta ? html.replace('</head>', `${meta}</head>`) : html;
  },
});

// The studio serves the build from lib/studio, so the CLI ships it without a runtime dependency
export default defineConfig({
  plugins: [react(), tailwindcss(), studioToken()],
  base: './',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { outDir: '../lib/studio', emptyOutDir: true },
  server: {
    proxy: {
      // Not passing the browser's Host and Origin through: the studio server refuses requests not addressed to it
      '/api': { target: STUDIO, changeOrigin: true, headers: { origin: STUDIO } },
    },
  },
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'] },
});
