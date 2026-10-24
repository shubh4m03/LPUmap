/**
 * Builds the isometric harness page (tests/perf/iso-harness) for the D8 perf
 * project and the harness a11y/screenshot spec. Production build, so the
 * numbers reflect minified code; the output goes to the OS temp folder, never
 * into the repository. Not the app's vite.config.ts (no PWA, no app entry).
 */
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { ISO_HARNESS_PORT } from './iso-harness-port.ts';

const repo = resolve(import.meta.dirname, '../..');
const ISO_HARNESS_OUT = process.env.ISO_HARNESS_OUT ?? join(tmpdir(), 'lpu-atlas-iso-harness');

export default defineConfig({
  root: resolve(repo, 'tests/perf/iso-harness'),
  publicDir: resolve(repo, 'public'),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: ISO_HARNESS_OUT,
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  preview: { port: ISO_HARNESS_PORT, strictPort: true },
  server: { port: ISO_HARNESS_PORT, strictPort: true },
});
