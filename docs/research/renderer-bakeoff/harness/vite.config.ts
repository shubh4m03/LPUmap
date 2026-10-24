/**
 * Builds the Gate 3 bake-off harness (research only). Root is this folder,
 * the app's public/ provides the data and fonts, and the output goes to the
 * directory given in BAKEOFF_OUT (a temp folder; never the repository).
 */
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('../../../../', import.meta.url));

export default defineConfig({
  root: here,
  publicDir: `${repo}public`,
  plugins: [react(), tailwindcss()],
  build: {
    outDir: process.env.BAKEOFF_OUT ?? `${here}../../../../node_modules/.cache/bakeoff-dist`,
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
  },
  preview: { port: Number(process.env.BAKEOFF_PORT ?? 4471), strictPort: true },
});
