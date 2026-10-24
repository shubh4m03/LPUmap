/**
 * Building Studio test helpers: the REAL base dataset (public/data) as the
 * studio validator sees it, a controllable clock, valid drafts at two empty
 * on-campus sites, and table snapshots for "no partial state" assertions.
 *
 * Sites were chosen from the data (inside the boundary, ≥ 120 m from any
 * building anchor, ~250 m from the boundary, away from review sections); the
 * suites assert those preconditions instead of trusting the constants.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildStudioBaseData, type StudioBaseData, type StudioBaseParts } from '../../../server/base-data.ts';
import type { SqlDatabase } from '../../../server/db/types.ts';
import type { StudioContext } from '../../../server/domain/studio/context.ts';
import type { IdGenerator } from '../../../server/ids.ts';
import type { StudioDraft } from '../../../src/building-studio/schema.ts';
import {
  boundaryFileSchema,
  boundaryReviewFileSchema,
  buildingsFileSchema,
  graphFileSchema,
  manifestSchema,
  placesFileSchema,
  type LngLat,
} from '../../../src/data/schema.ts';
import { REPO_ROOT } from '../helpers/test-db.ts';

export const OWNER = 'owner@example.org';
export const T0 = Date.parse('2026-10-24T08:00:00.000Z');

/** Two empty on-campus sites ~47 m apart (a 20 m box at each never overlaps the other or a base building). */
export const SITE_A: LngLat = [75.7015, 31.2495];
export const SITE_B: LngLat = [75.702, 31.2495];

const readData = (f: string): unknown =>
  JSON.parse(readFileSync(join(REPO_ROOT, 'public', 'data', f), 'utf8'));

let partsMemo: StudioBaseParts | null = null;

/** Parsed public/data parts (memoised; never written). */
export function realStudioParts(): StudioBaseParts {
  partsMemo ??= {
    datasetVersion: manifestSchema.parse(readData('manifest.json')).datasetVersion,
    buildings: buildingsFileSchema.parse(readData('buildings.geojson')),
    places: placesFileSchema.parse(readData('places.json')).places,
    graph: graphFileSchema.parse(readData('graph.json')),
    boundary: boundaryFileSchema.parse(readData('boundary.geojson')),
    review: boundaryReviewFileSchema.parse(readData('boundary-review.json')),
  };
  return partsMemo;
}

let baseMemo: StudioBaseData | null = null;
export function realStudioBase(): StudioBaseData {
  baseMemo ??= buildStudioBaseData(realStudioParts());
  return baseMemo;
}

/** The same dataset under a new datasetVersion with the given base buildings removed (a data refresh). */
export function studioBaseWithout(
  removed: readonly string[],
  datasetVersion = 'test-refresh-1',
): StudioBaseData {
  const parts = realStudioParts();
  return buildStudioBaseData({
    ...parts,
    datasetVersion,
    buildings: {
      ...parts.buildings,
      features: parts.buildings.features.filter((f) => !removed.includes(f.properties.id)),
    },
  });
}

/** Each call returns a context one second later than the previous one. */
export function studioClock(studio: StudioBaseData = realStudioBase(), start = T0) {
  let t = start;
  return {
    owner(extra: Partial<StudioContext> = {}): StudioContext {
      t += 1000;
      return { now: new Date(t), actor: OWNER, studio, ...extra };
    },
    advance(ms: number) {
      t += ms;
    },
    get now() {
      return new Date(t);
    },
  };
}

/** Id generator returning the given ids in order. */
export function fixedIds(...ids: string[]): IdGenerator {
  const queue = [...ids];
  return {
    next() {
      const id = queue.shift();
      if (!id) throw new Error('fixedIds exhausted');
      return id;
    },
  };
}

export const PRIVATE_NOTE = 'PRIVATE-OWNER-NOTE-7f3a: never public';

/**
 * A valid, publishable new building: a generic 20 × 20 m, 3-storey box at
 * SITE_A (3 × 3.2 m = 9.6 m body height, inside the height tolerance).
 */
export function newDraft(
  over: { model?: Partial<StudioDraft['model']> } & Partial<Omit<StudioDraft, 'model'>> = {},
): StudioDraft {
  const { model, ...rest } = over;
  return {
    identity: {
      name: 'Fixture Pavilion',
      aliases: [],
      categoryId: 'building',
      subtype: null,
      description: null,
      notes: PRIVATE_NOTE,
      directoryVisible: true,
    },
    model: {
      modelConfigVersion: 1,
      generatorId: 'box',
      generatorVersion: 1,
      anchor: SITE_A,
      rotationDeg: 0,
      widthM: 20,
      lengthM: 20,
      heightM: 9.6,
      floors: 3,
      floorHeightM: 3.2,
      baseOffsetM: 0,
      shape: { kind: 'box' },
      roof: { shape: 'flat', colour: '#8a8a8a', material: 'concrete' },
      facade: {
        material: 'plaster',
        wallColour: '#d9d4c7',
        windowPattern: 'punched',
        windowDensity: 0.4,
        balconies: false,
        entranceSide: 'front',
      },
      detailLevel: 'facade',
      ...model,
    } as StudioDraft['model'],
    verification: { status: 'unverified' },
    accessNodeId: null,
    templateRef: null,
    positionCorrection: null,
    ...rest,
  };
}

/** A 'footprint-prism' model of base building `targetId` (identity/access stay in the place override). */
export function prismDraft(targetId: string, studio: StudioBaseData = realStudioBase()): StudioDraft {
  const f = studio.buildingsById.get(targetId);
  if (!f) throw new Error(`no base building ${targetId}`);
  return newDraft({
    identity: null,
    model: {
      generatorId: 'footprint-prism',
      shape: { kind: 'footprint-prism' },
      anchor: [f.properties.anchorLon!, f.properties.anchorLat!] as LngLat,
      // informational for footprint-prism (the server overwrites them from the base footprint)
      widthM: 10,
      lengthM: 10,
    },
  });
}

export const publishBody = (revision: number, over: Record<string, unknown> = {}) => ({
  revision,
  acknowledgements: [],
  changeSummary: 'First publication of the fixture building',
  ...over,
});

export interface StudioSnapshot {
  buildings: unknown[];
  versions: unknown[];
  templates: unknown[];
  templateVersions: unknown[];
  meta: unknown[];
  audit: { id: number; action: string; outcome: string; entity_id: string | null }[];
}

/** Every studio row + meta + the audit log (ids, actions, outcomes). */
export async function studioSnapshot(db: SqlDatabase): Promise<StudioSnapshot> {
  const all = async (sql: string) => (await db.prepare(sql).all()).results;
  return {
    buildings: await all('SELECT * FROM studio_buildings ORDER BY id'),
    versions: await all('SELECT * FROM studio_building_versions ORDER BY building_id, version'),
    templates: await all('SELECT * FROM studio_templates ORDER BY id'),
    templateVersions: await all('SELECT * FROM studio_template_versions ORDER BY template_id, version'),
    meta: await all('SELECT * FROM meta ORDER BY key'),
    audit: (await all(
      'SELECT id, action, outcome, entity_id FROM audit_events ORDER BY id',
    )) as StudioSnapshot['audit'],
  };
}

export const publicationVersion = async (db: SqlDatabase): Promise<number> =>
  Number(
    (await db.prepare("SELECT value FROM meta WHERE key = 'publication_version'").first<{ value: string }>())
      ?.value ?? 0,
  );

/** Audit rows (newest last) for one studio entity. */
export async function auditOf(db: SqlDatabase, entityId: string) {
  const { results } = await db
    .prepare('SELECT * FROM audit_events WHERE entity_id = ? ORDER BY id')
    .bind(entityId)
    .all<{
      id: number;
      action: string;
      outcome: string;
      entity_type: string;
      before_json: string | null;
      after_json: string | null;
      detail: string | null;
      actor: string;
    }>();
  return results;
}
