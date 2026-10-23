/** Loads the REAL generated dataset from public/data (validated with the production schemas). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { z } from 'zod';
import type { CampusData } from '../../../src/data/campus-data.ts';
import {
  basemapFileSchema,
  boundaryFileSchema,
  buildingsFileSchema,
  DATA_FILES,
  graphFileSchema,
  manifestSchema,
  placesFileSchema,
  relationsFileSchema,
} from '../../../src/data/schema.ts';

export const DATA_DIR = join(process.cwd(), 'public', 'data');

const read = <S extends z.ZodType>(schema: S, file: string): z.infer<S> =>
  schema.parse(JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')));

export function loadRealCampus(): CampusData {
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

/** Deterministic Fisher–Yates shuffle (mulberry32), so failures are reproducible. */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
