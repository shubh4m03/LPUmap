import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { thirdPartyLicensesPlugin } from './scripts/lib/third-party-licenses.ts';

// PWA settings live in src/offline/pwa-config.ts so the cache strategy is
// documented next to the offline module that depends on it.
import { pwaOptions } from './src/offline/pwa-config.ts';
import { createPrecacheScope } from './src/offline/precache-scope.ts';

// Every bare `zod` import in the browser bundle goes through src/csp/zod.ts, which switches
// Zod's JIT off before any schema exists, so its `new Function` probe never trips the CSP.
const ZOD_JITLESS = fileURLToPath(new URL('./src/csp/zod.ts', import.meta.url));
const ROOT = fileURLToPath(new URL('./', import.meta.url));

// Admin-only chunks (/admin, Studio, Templates, Artwork) stay out of the public precache (G-19).
const precacheScope = createPrecacheScope();

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    precacheScope.plugin,
    thirdPartyLicensesPlugin(ROOT),
    VitePWA({
      ...pwaOptions,
      workbox: { ...pwaOptions.workbox, manifestTransforms: [precacheScope.manifestTransform] },
    }),
  ],
  resolve: { alias: [{ find: /^zod$/, replacement: ZOD_JITLESS }] },
  build: {
    target: 'es2022',
    // No source maps in the published build: they would ship the full source with the build
    // machine's absolute paths (user name included). Debug a local build with `--sourcemap`.
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
