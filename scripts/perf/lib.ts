/**
 * Shared helpers of the performance measurement scripts (scripts/perf/*.ts).
 * They measure the REAL shipped dataset (public/data) and the real artwork
 * manifest (public/isometric-art/manifest.json), parsed with the production
 * schemas, in Node, the same way docs/PERFORMANCE.md describes. Nothing here
 * is a test: the scripts print what they measured and, with --check, exit 1
 * when a documented budget is exceeded.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { z } from 'zod';
import type { CampusData } from '../../src/data/campus-data.ts';
import {
  basemapFileSchema,
  boundaryFileSchema,
  buildingsFileSchema,
  DATA_FILES,
  graphFileSchema,
  manifestSchema,
  placesFileSchema,
  relationsFileSchema,
} from '../../src/data/schema.ts';
import type { IsometricArtManifest } from '../../src/isometric-art/schema.ts';
import { isometricArtManifestSchema } from '../../src/isometric-art/schema.ts';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The dataset the app loads at start (the seven start-up files of src/data/loader.ts), parsed with its schemas. */
export function loadCampusDataFromDisk(dataDir = join(REPO_ROOT, 'public', 'data')): CampusData {
  const read = <S extends z.ZodType>(schema: S, file: string): z.infer<S> =>
    schema.parse(JSON.parse(readFileSync(join(dataDir, file), 'utf8')));
  return {
    manifest: read(manifestSchema, DATA_FILES.manifest),
    boundary: read(boundaryFileSchema, DATA_FILES.boundary),
    buildings: read(buildingsFileSchema, DATA_FILES.buildings),
    basemap: read(basemapFileSchema, DATA_FILES.basemap),
    places: read(placesFileSchema, DATA_FILES.places).places,
    relations: read(relationsFileSchema, DATA_FILES.relations).relations,
    graph: read(graphFileSchema, DATA_FILES.graph),
  };
}

/** The published artwork manifest, or null when it is absent or invalid (the app then runs without it). */
export function loadArtworkManifestFromDisk(
  path = join(REPO_ROOT, 'public', 'isometric-art', 'manifest.json'),
): IsometricArtManifest | null {
  try {
    return isometricArtManifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return null;
  }
}

/** mulberry32: a small seeded PRNG, so every run times the same queries and pairs. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Nearest-rank percentile (0 < p ≤ 1) of a non-empty list; NaN for an empty one. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[rank]!;
}

export interface TimingSummary {
  n: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

export function summarize(values: readonly number[]): TimingSummary {
  const n = values.length;
  const mean = n === 0 ? Number.NaN : values.reduce((s, v) => s + v, 0) / n;
  return {
    n,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: n === 0 ? Number.NaN : Math.max(...values),
    mean,
  };
}

export const ms = (v: number): string => (Number.isFinite(v) ? `${v.toFixed(2)} ms` : 'n/a');

/** The machine and runtime a measurement ran on (printed with every result, never a verdict about another machine). */
export async function environmentLine(): Promise<string> {
  const os = await import('node:os');
  const cpus = os.cpus();
  return `${cpus[0]?.model.trim() ?? 'unknown CPU'} (${cpus.length} logical CPUs), ${os.platform()} ${os.release()}, Node ${process.versions.node}`;
}
