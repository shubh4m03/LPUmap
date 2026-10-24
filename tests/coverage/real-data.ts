/**
 * Shared loader for the building-coverage suite: the REAL processed dataset
 * (public/data, parsed with the production schemas), an independent
 * re-classification of every footprint of the committed raw OSM snapshot with
 * the shared boundary service, and the dataset committed at git HEAD (the
 * deployed baseline, any schema version) for regression comparisons.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { z } from 'zod';
import type { CampusData } from '../../src/data/campus-data.ts';
import {
  basemapFileSchema,
  boundaryFileSchema,
  boundaryReviewFileSchema,
  buildingsFileSchema,
  contextPlacesFileSchema,
  DATA_FILES,
  detectionsFileSchema,
  graphFileSchema,
  manifestSchema,
  placesFileSchema,
  relationsFileSchema,
} from '../../src/data/schema.ts';
import type { BoundaryReviewFile, DetectionsFile, Place } from '../../src/data/schema.ts';
import { boundaryFromFeatureCollection } from '../../src/geo/boundary.ts';
import type { CampusBoundary } from '../../src/geo/boundary.ts';
import { loadBoundaryReview } from '../../scripts/lib/boundary-review.ts';
import { collectBuildings } from '../../scripts/lib/build-buildings.ts';
import type { BuildingRecord } from '../../scripts/lib/build-buildings.ts';
import { classifyBuildings } from '../../scripts/lib/membership.ts';
import type { ClassifiedBuilding } from '../../scripts/lib/membership.ts';
import { mergeOsmData, parseOsm } from '../../scripts/lib/osm-parse.ts';
import { rawSnapshotFiles } from '../../scripts/lib/pipeline.ts';

export const REPO = fileURLToPath(new URL('../..', import.meta.url));
export const DATA_DIR = join(REPO, 'public', 'data');
export const RAW_OSM_DIR = join(REPO, 'data', 'raw', 'osm');
export const CURATED_DIR = join(REPO, 'data', 'curated');

const read = <S extends z.ZodType>(schema: S, file: string): z.infer<S> =>
  schema.parse(JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')));

export interface RealData extends CampusData {
  contextPlaces: Place[];
  detections: DetectionsFile;
  review: BoundaryReviewFile;
  quality: {
    duplicatesResolved: Array<{ kept: string; dropped: string; iou: number }>;
    membership: { outside: Array<{ id: string }>; uncertain: Array<{ id: string }>; footprintsInSnapshot: number };
  };
}

export function loadRealData(): RealData {
  return {
    manifest: read(manifestSchema, DATA_FILES.manifest),
    boundary: read(boundaryFileSchema, DATA_FILES.boundary),
    buildings: read(buildingsFileSchema, DATA_FILES.buildings),
    basemap: read(basemapFileSchema, DATA_FILES.basemap),
    places: read(placesFileSchema, DATA_FILES.places).places,
    relations: read(relationsFileSchema, DATA_FILES.relations).relations,
    graph: read(graphFileSchema, DATA_FILES.graph),
    contextPlaces: read(contextPlacesFileSchema, DATA_FILES.contextPlaces).places,
    detections: read(detectionsFileSchema, DATA_FILES.detections),
    review: read(boundaryReviewFileSchema, DATA_FILES.boundaryReview),
    quality: JSON.parse(readFileSync(join(DATA_DIR, DATA_FILES.quality), 'utf8')) as RealData['quality'],
  };
}

export interface Reclassified {
  boundary: CampusBoundary;
  records: BuildingRecord[];
  classified: ClassifiedBuilding[];
  byId: Map<string, ClassifiedBuilding>;
}

/** Every building footprint of the committed raw snapshot, classified against the SHIPPED boundary. */
export function reclassifyRawSnapshot(data: Pick<RealData, 'boundary'>): Reclassified {
  const osm = mergeOsmData(
    ...rawSnapshotFiles(RAW_OSM_DIR).map((f) => parseOsm(readFileSync(join(RAW_OSM_DIR, f), 'utf8'))),
  );
  const boundary = boundaryFromFeatureCollection(data.boundary);
  const review = loadBoundaryReview(CURATED_DIR);
  const records = collectBuildings(osm).buildings;
  const classified = classifyBuildings(records, boundary, review.sections, review.decisions);
  return { boundary, records, classified, byId: new Map(classified.map((c) => [c.record.id, c])) };
}

/** A file of the dataset committed at git HEAD, or null outside a git checkout. */
export function committedJson<T>(file: string): T | null {
  try {
    const text = execFileSync('git', ['show', `HEAD:public/data/${file}`], {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
