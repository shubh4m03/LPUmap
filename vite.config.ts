import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// PWA settings live in src/offline/pwa-config.ts so the cache strategy is
// documented next to the offline module that depends on it.
import { pwaOptions } from './src/offline/pwa-config.ts';

// Every bare `zod` import in the browser bundle goes through src/csp/zod.ts, which switches
// Zod's JIT off before any schema exists, so its `new Function` probe never trips the CSP.
const ZOD_JITLESS = fileURLToPath(new URL('./src/csp/zod.ts', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA(pwaOptions)],
  resolve: { alias: [{ find: /^zod$/, replacement: ZOD_JITLESS }] },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
