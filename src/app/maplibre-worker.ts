/**
 * MapLibre 6 locates its worker relative to its own module URL, which breaks
 * once the library is bundled into a hashed chunk (the worker file is never
 * emitted). Vite's `?url` import emits the self-contained worker as a
 * same-origin asset (allowed by the CSP's worker-src 'self') and we point
 * MapLibre at it before any map is created.
 */
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

setWorkerUrl(new URL(workerUrl, window.location.href).href);
