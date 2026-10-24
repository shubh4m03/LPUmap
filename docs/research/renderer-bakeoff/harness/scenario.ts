/**
 * Gate 3 bake-off scenario (research harness, never shipped).
 *
 * Four REAL campus footprints from public/data/buildings.geojson, each given
 * a `footprint-prism` studio model (the generator a base-building model uses):
 *   A  large academic   osm:way/354755644 "Lovely Institute of Technology"
 *                       (named institute; its data category is 'building':
 *                       use not recorded)
 *   B  non-rectangular  osm:way/422548297 (44 vertices, 10 floors mapped)
 *   C  canteen STAND-IN osm:way/1550425052, the only campus footprint whose
 *                       data category is 'food' — NOT confirmed as a canteen
 *   D  hostel STAND-IN  osm:way/422437895, a 46 m × 19 m slab with 10 floors
 *                       mapped — nothing in the data says it is a hostel
 * plus 46 starter-library models (asset-library.ts) at synthetic grid
 * positions on open campus ground, to reach 50 instances. These placements
 * exist only in this harness: they are load-test fixtures, not buildings,
 * and are never published or shown in the product.
 */
import type { Feature, Polygon } from 'geojson';
import { modelFromVariant, starterLibrary } from '../../../../src/building-studio/asset-library.ts';
import { deriveFootprint } from '../../../../src/building-studio/footprint.ts';
import type { ModelConfigV1, StudioFootprint } from '../../../../src/building-studio/schema.ts';
import type { StudioRenderSource } from '../../../../src/building-studio/render/maplibre/index.ts';
import type { BuildingProps, BuildingsFile, BoundaryFile, LngLat } from '../../../../src/data/schema.ts';

export const REAL_STRUCTURES = [
  { key: 'A', id: 'osm:way/354755644', label: 'Large academic (named institute)', pattern: 'punched' },
  { key: 'B', id: 'osm:way/422548297', label: 'Non-rectangular footprint (44 vertices)', pattern: 'ribbon' },
  {
    key: 'C',
    id: 'osm:way/1550425052',
    label: 'Canteen STAND-IN (data category food; unconfirmed)',
    pattern: 'grid',
  },
  {
    key: 'D',
    id: 'osm:way/422437895',
    label: 'Hostel STAND-IN (10-floor slab; unconfirmed)',
    pattern: 'punched',
  },
] as const;

export interface BakeoffInstance {
  key: string;
  label: string;
  kind: 'real-structure' | 'library';
  source: StudioRenderSource;
  config: ModelConfigV1;
  /** The buildings-source feature (2D, picking, extrusion fallback). */
  feature: Feature<Polygon, BuildingProps>;
}

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
/** A syntactically valid studio id (`stu:` + 24 base32 chars) unique per index. */
export function bakeoffId(i: number): string {
  let tail = '';
  let n = i;
  for (let k = 0; k < 4; k++) {
    tail = BASE32[n % 32]! + tail;
    n = Math.floor(n / 32);
  }
  return `stu:bakeoffharnessmodel${tail}`.slice(0, 28);
}

function ringContains(ring: readonly LngLat[], p: LngLat): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside;
  }
  return inside;
}

function polygonContains(coords: readonly (readonly LngLat[])[], p: LngLat): boolean {
  if (!coords[0] || !ringContains(coords[0], p)) return false;
  return !coords.slice(1).some((h) => ringContains(h, p));
}

export function featureFor(
  template: BuildingProps,
  id: string,
  footprint: StudioFootprint,
  config: ModelConfigV1,
  areaM2: number,
): Feature<Polygon, BuildingProps> {
  const props = {
    ...template,
    id,
    name: null,
    displayName: 'Bake-off test model (not a real building)',
    categoryId: 'building',
    // Harness-only values (change C1 adds them to the data schema).
    geometrySource: 'studio' as unknown as BuildingProps['geometrySource'],
    renderHeightSource: 'studio-model' as unknown as BuildingProps['renderHeightSource'],
    sourceId: 'owner',
    sourceRef: id,
    levels: null,
    levelsSource: null,
    fidelityLevel: 0 as const,
    fidelityReason: 'Bake-off fixture.',
    directoryKey: null,
    directoryCell: null,
    areaM2,
    anchorLon: config.anchor[0],
    anchorLat: config.anchor[1],
    renderMinHeightM: config.baseOffsetM,
    renderHeightM: config.baseOffsetM + config.heightM,
  } satisfies BuildingProps;
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Polygon', coordinates: footprint.coordinates },
    properties: props,
  };
}

function prismConfig(
  f: BuildingsFile['features'][number],
  pattern: 'punched' | 'ribbon' | 'grid',
): ModelConfigV1 {
  const p = f.properties;
  const floors = Math.max(1, Math.round(p.levels ?? 2));
  return {
    modelConfigVersion: 1,
    generatorId: 'footprint-prism',
    generatorVersion: 1,
    anchor: [p.anchorLon, p.anchorLat],
    rotationDeg: 0,
    widthM: 10,
    lengthM: 10,
    heightM: p.renderHeightM - p.renderMinHeightM,
    floors,
    floorHeightM: Math.min(8, Math.max(2.4, (p.renderHeightM - p.renderMinHeightM) / floors)),
    baseOffsetM: p.renderMinHeightM,
    shape: { kind: 'footprint-prism' },
    roof: { shape: 'flat', colour: '#b9b2a6', material: 'concrete' },
    facade: {
      material: 'plaster',
      wallColour: '#d8cfc0',
      windowPattern: pattern,
      windowDensity: 0.55,
      balconies: false,
      entranceSide: 'none',
    },
    detailLevel: 'facade',
  } as ModelConfigV1;
}

export function buildScenario(
  buildings: BuildingsFile,
  boundary: BoundaryFile,
  count = 50,
): BakeoffInstance[] {
  const out: BakeoffInstance[] = [];
  const byId = new Map(buildings.features.map((f) => [f.properties.id, f]));
  const template = buildings.features[0]!.properties;

  for (const r of REAL_STRUCTURES) {
    if (out.length >= count) break;
    const f = byId.get(r.id);
    if (!f || f.geometry.type !== 'Polygon') throw new Error(`Bake-off structure ${r.id} is missing`);
    const config = prismConfig(f, r.pattern);
    const footprint: StudioFootprint = { type: 'Polygon', coordinates: f.geometry.coordinates as LngLat[][] };
    const source: StudioRenderSource = {
      publicId: r.id,
      recordId: bakeoffId(out.length),
      version: 1,
      footprint,
      model: config,
    };
    const feature: Feature<Polygon, BuildingProps> = {
      type: 'Feature',
      id: r.id,
      geometry: { type: 'Polygon', coordinates: footprint.coordinates },
      properties: {
        ...f.properties,
        renderHeightSource: 'studio-model' as unknown as BuildingProps['renderHeightSource'],
        renderMinHeightM: config.baseOffsetM,
        renderHeightM: config.baseOffsetM + config.heightM,
      },
    };
    out.push({ key: r.key, label: r.label, kind: 'real-structure', source, config, feature });
  }

  // Library models on a 70 m grid over open campus ground (inside the boundary, off every footprint).
  const variants = starterLibrary().flatMap((e) => e.definition.variants.map((v) => ({ e, v })));
  const boundaryCoords = boundary.features.flatMap((f) =>
    f.geometry.type === 'Polygon'
      ? [f.geometry.coordinates as LngLat[][]]
      : (f.geometry.coordinates as LngLat[][][]),
  );
  const occupied: Array<readonly (readonly LngLat[])[]> = buildings.features.flatMap((f) =>
    f.geometry.type === 'Polygon'
      ? [f.geometry.coordinates as LngLat[][]]
      : (f.geometry.coordinates as LngLat[][][]),
  );
  const [w, s, e, n] = [75.696, 31.2465, 75.7105, 31.2615];
  const stepLon = 70 / (111320 * Math.cos((31.253 * Math.PI) / 180));
  const stepLat = 70 / 110574;
  let vi = 0;
  for (let lat = n; lat > s && out.length < count; lat -= stepLat) {
    for (let lon = w; lon < e && out.length < count; lon += stepLon) {
      const p: LngLat = [lon, lat];
      if (!boundaryCoords.some((c) => polygonContains(c, p))) continue;
      const pick = variants[vi % variants.length]!;
      const config = modelFromVariant(pick.v, { anchor: p, rotationDeg: 0 });
      const fp = deriveFootprint(config);
      if (!fp.ok) continue;
      const hits = (q: LngLat) => occupied.some((c) => polygonContains(c, q));
      const corners = fp.footprint.coordinates[0]!;
      if (hits(p) || corners.some(hits)) continue;
      if (!corners.every((c) => boundaryCoords.some((b) => polygonContains(b, c)))) continue;
      vi += 1;
      occupied.push(fp.footprint.coordinates);
      const id = bakeoffId(out.length);
      out.push({
        key: `L${out.length}`,
        label: `${pick.e.definition.name} / ${pick.v.id}`,
        kind: 'library',
        source: { publicId: id, recordId: id, version: 1, footprint: fp.footprint, model: config },
        config,
        feature: featureFor(template, id, fp.footprint, config, fp.areaM2),
      });
    }
  }
  return out;
}

/** The buildings source with the scenario applied: base targets replaced, new models appended. */
export function scenarioBuildings(
  buildings: BuildingsFile,
  instances: readonly BakeoffInstance[],
): BuildingsFile {
  const replaced = new Map(
    instances.filter((i) => i.kind === 'real-structure').map((i) => [i.source.publicId, i]),
  );
  const features = buildings.features.map((f) => {
    const r = replaced.get(f.properties.id);
    return r ? (r.feature as unknown as BuildingsFile['features'][number]) : f;
  });
  for (const i of instances)
    if (i.kind === 'library') features.push(i.feature as unknown as BuildingsFile['features'][number]);
  return { ...buildings, features };
}

/**
 * Lighting check: the same 30 m × 30 m × 20 m box twice, 60 m apart on open
 * ground, in the same colour — once as a plain extrusion (west) and once
 * through the custom layer (east, no windows) — so face brightness can be
 * compared pixel by pixel.
 */
export function lightCheckScenario(buildings: BuildingsFile): BakeoffInstance[] {
  const template = buildings.features[0]!.properties;
  const out: BakeoffInstance[] = [];
  for (const [i, lon] of [75.6995, 75.70013].entries()) {
    const anchor: LngLat = [lon, 31.2475];
    const config = {
      modelConfigVersion: 1,
      generatorId: 'box',
      generatorVersion: 1,
      anchor,
      rotationDeg: 0,
      widthM: 30,
      lengthM: 30,
      heightM: 20,
      floors: 6,
      floorHeightM: 3.2,
      baseOffsetM: 0,
      shape: { kind: 'box' },
      roof: { shape: 'flat', colour: '#c7b9a3', material: 'concrete' },
      facade: {
        material: 'plaster',
        wallColour: '#c7b9a3',
        windowPattern: 'none',
        windowDensity: 0,
        balconies: false,
        entranceSide: 'none',
      },
      detailLevel: 'massing',
    } as ModelConfigV1;
    const fp = deriveFootprint(config);
    if (!fp.ok) throw new Error(fp.message);
    const id = bakeoffId(900 + i);
    const feature = featureFor(template, id, fp.footprint, config, fp.areaM2);
    if (i === 0) feature.properties.renderHeightSource = 'osm-height';
    out.push({
      key: i === 0 ? 'EXTRUSION' : 'CUSTOM',
      label: 'light check',
      kind: 'library',
      source: { publicId: id, recordId: id, version: 1, footprint: fp.footprint, model: config },
      config,
      feature,
    });
  }
  return out;
}
