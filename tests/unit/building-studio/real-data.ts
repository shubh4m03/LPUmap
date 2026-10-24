/**
 * The REAL generated dataset (public/data, read-only) as studio validation
 * and merge inputs. Loaded once per test file.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { z } from 'zod';
import type { CampusData } from '../../../src/data/campus-data.ts';
import {
  basemapFileSchema,
  boundaryFileSchema,
  boundaryReviewFileSchema,
  buildingsFileSchema,
  DATA_FILES,
  graphFileSchema,
  manifestSchema,
  placesFileSchema,
  relationsFileSchema,
} from '../../../src/data/schema.ts';
import { boundaryFromFeatureCollection } from '../../../src/geo/boundary.ts';
import type { StudioValidationContext } from '../../../src/building-studio/validate.ts';

const DATA_DIR = join(process.cwd(), 'public', 'data');
const read = <S extends z.ZodType>(schema: S, file: string): z.infer<S> =>
  schema.parse(JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')));

let cached: { campus: CampusData; base: StudioValidationContext['base'] } | null = null;

export function realData(): { campus: CampusData; base: StudioValidationContext['base'] } {
  if (cached) return cached;
  const campus: CampusData = {
    manifest: read(manifestSchema, DATA_FILES.manifest),
    boundary: read(boundaryFileSchema, DATA_FILES.boundary),
    buildings: read(buildingsFileSchema, DATA_FILES.buildings),
    basemap: read(basemapFileSchema, DATA_FILES.basemap),
    places: read(placesFileSchema, DATA_FILES.places).places,
    relations: read(relationsFileSchema, DATA_FILES.relations).relations,
    graph: read(graphFileSchema, DATA_FILES.graph),
  };
  const review = read(boundaryReviewFileSchema, DATA_FILES.boundaryReview);
  cached = {
    campus,
    base: {
      buildings: campus.buildings,
      places: campus.places,
      graph: campus.graph,
      boundary: boundaryFromFeatureCollection(campus.boundary),
      reviewSections: review.sections,
      curatedDecisions: review.decisions,
    },
  };
  return cached;
}

export function realContext(over: Partial<StudioValidationContext> = {}): StudioValidationContext {
  return {
    base: realData().base,
    published: [],
    template: null,
    recordId: null,
    targetId: null,
    today: '2026-10-24',
    ...over,
  };
}
