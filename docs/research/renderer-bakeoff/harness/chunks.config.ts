/**
 * Gate 3 chunk comparison (research): builds the custom-layer chunk entry and
 * the isometric overview as two entries of one build, so code they share (the
 * studio mesh module and schemas) lands in a shared chunk and each path's own
 * cost is visible. React, zod and maplibre-gl are external because the app
 * already loads them before either path, and so is every app module outside
 * src/isometric/** and src/building-studio/** (config, data schemas, UI kit:
 * all in the startup chunks). Output: BAKEOFF_CHUNKS_OUT (a temp dir).
 */
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));

export default defineConfig({
  root: repo,
  plugins: [react()],
  logLevel: 'warn',
  build: {
    outDir: process.env.BAKEOFF_CHUNKS_OUT ?? `${repo}node_modules/.cache/bakeoff-chunks`,
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        custom: `${repo}src/building-studio/render/maplibre/runtime.ts`,
        iso: `${repo}src/isometric/IsoView.tsx`,
      },
      preserveEntrySignatures: 'exports-only',
      external: (id: string) => {
        if (/^(react|react-dom|zod|maplibre-gl)($|\/)/.test(id)) return true;
        const path = id.replaceAll('\\', '/');
        if (!path.startsWith(`${repo.replaceAll('\\', '/')}src/`)) return false;
        return !/\/src\/(isometric|building-studio)\//.test(path);
      },
      output: { entryFileNames: '[name].js', chunkFileNames: 'shared-[hash].js' },
    },
  },
});
