/** Basemap GeoJSON (roads, paths, land cover) from our own OSM snapshot — no third-party tiles. */
import type { BasemapFile, BasemapLayer, LngLat } from '../../src/data/schema.ts';
import {
  bboxIntersects,
  bboxOfCoords,
  dedupeConsecutive,
  multiPolygonCoords,
  ringProblems,
} from './geometry.ts';
import type { MultiPolygon } from './geometry.ts';
import { relationGeometry, wayCoords, wayPolygon } from './osm-geometry.ts';
import { sortedValues } from './osm-parse.ts';
import type { OsmData, Tags } from './osm-parse.ts';
import { nameFromTags } from './place-fields.ts';

const HIGHWAY_LAYER: Record<string, BasemapLayer> = {
  trunk: 'road-major',
  trunk_link: 'road-major',
  primary: 'road-major',
  primary_link: 'road-major',
  secondary: 'road-major',
  secondary_link: 'road-major',
  tertiary: 'road-major',
  tertiary_link: 'road-major',
  residential: 'road',
  unclassified: 'road',
  living_street: 'road',
  road: 'road',
  service: 'service',
  footway: 'path',
  path: 'path',
  pedestrian: 'path',
  cycleway: 'path',
  track: 'path',
  corridor: 'path',
  bridleway: 'path',
  steps: 'steps',
};

const GREEN: Record<string, readonly string[]> = {
  leisure: ['park', 'garden'],
  landuse: ['grass', 'meadow', 'forest', 'village_green', 'recreation_ground'],
  natural: ['grassland', 'wood', 'scrub'],
};
const WATER_LANDUSE = ['reservoir', 'basin'];

/** Area classification, or null when the feature is not a basemap area. */
export function areaLayer(tags: Tags): { layer: BasemapLayer; subclass: string } | null {
  for (const [key, values] of Object.entries(GREEN)) {
    const v = tags[key];
    if (v && values.includes(v)) return { layer: 'green', subclass: v };
  }
  if (tags.natural === 'water' || tags.water || (tags.landuse && WATER_LANDUSE.includes(tags.landuse))) {
    return { layer: 'water', subclass: tags.water ?? tags.landuse ?? 'water' };
  }
  if (tags.leisure === 'pitch') return { layer: 'pitch', subclass: tags.sport ?? 'pitch' };
  if (
    tags.amenity === 'parking' ||
    tags.amenity === 'bicycle_parking' ||
    tags.amenity === 'motorcycle_parking'
  ) {
    return { layer: 'parking', subclass: tags.amenity };
  }
  if (tags.landuse) return { layer: 'landuse', subclass: tags.landuse };
  return null;
}

/** Line classification for highways and waterways. */
export function lineLayer(tags: Tags): { layer: BasemapLayer; subclass: string } | null {
  const hw = tags.highway;
  if (hw && HIGHWAY_LAYER[hw] && tags.area !== 'yes') return { layer: HIGHWAY_LAYER[hw], subclass: hw };
  if (tags.waterway && ['river', 'stream', 'canal', 'drain', 'ditch'].includes(tags.waterway)) {
    return { layer: 'water', subclass: tags.waterway };
  }
  return null;
}

type Feature = BasemapFile['features'][number];

function polygonGeometry(mp: MultiPolygon): Feature['geometry'] {
  return mp.length === 1
    ? { type: 'Polygon', coordinates: mp[0] }
    : { type: 'MultiPolygon', coordinates: mp };
}

const validMultiPolygon = (mp: MultiPolygon) =>
  mp.length > 0 && mp.every((poly) => poly.every((ring) => ringProblems(ring).length === 0));

/**
 * Area layers that may extend beyond the campus as orientation context (owner
 * decision 2: roads, paths, greens and water). Every other area layer
 * (landuse, pitch, parking) is kept only when it is mostly on campus.
 */
export const CONTEXT_AREA_LAYERS: ReadonlySet<BasemapLayer> = new Set(['green', 'water']);

export interface BasemapOptions {
  /**
   * Share (0–1) of an area feature inside the campus boundary, or null when it
   * cannot be measured (invalid polygon: the feature is then kept only if its
   * representative point is on campus, which the callback decides). Omit to
   * keep every area (v1 behaviour, used by unit tests).
   */
  campusShare?: (mp: MultiPolygon) => number;
  /** Features dropped because they are off-campus land use (reported, never silent). */
  dropped?: string[];
}

export function buildBasemap(
  osm: OsmData,
  maxBounds: readonly [number, number, number, number],
  opts: BasemapOptions = {},
): BasemapFile {
  const features: Feature[] = [];
  const keepArea = (id: string, layer: BasemapLayer, mp: MultiPolygon) => {
    if (!opts.campusShare || CONTEXT_AREA_LAYERS.has(layer)) return true;
    if (opts.campusShare(mp) >= 0.5) return true;
    opts.dropped?.push(id);
    return false;
  };
  const keep = (coords: LngLat[]) => {
    const bb = bboxOfCoords(coords);
    return bb !== null && bboxIntersects(bb, maxBounds);
  };
  for (const way of sortedValues(osm.ways)) {
    const props = { id: `osm:way/${way.id}`, name: nameFromTags(way.tags) };
    const line = lineLayer(way.tags);
    if (line) {
      const coords = wayCoords(osm, way);
      if (!coords) continue;
      const clean = dedupeConsecutive(coords);
      if (clean.length < 2 || !keep(clean)) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: clean },
        properties: { ...props, ...line },
      });
      continue;
    }
    const area = areaLayer(way.tags);
    if (!area || way.tags.building) continue;
    const poly = wayPolygon(osm, way);
    if (!poly || !validMultiPolygon([poly]) || !keep(poly.flat())) continue;
    if (!keepArea(props.id, area.layer, [poly])) continue;
    features.push({ type: 'Feature', geometry: polygonGeometry([poly]), properties: { ...props, ...area } });
  }
  for (const rel of sortedValues(osm.relations)) {
    if (rel.tags.type !== 'multipolygon' || rel.tags.building) continue;
    const area = areaLayer(rel.tags);
    if (!area) continue;
    const geom = relationGeometry(osm, rel);
    if (!validMultiPolygon(geom.multiPolygon) || !keep(multiPolygonCoords(geom.multiPolygon))) continue;
    if (!keepArea(`osm:relation/${rel.id}`, area.layer, geom.multiPolygon)) continue;
    features.push({
      type: 'Feature',
      geometry: polygonGeometry(geom.multiPolygon),
      properties: { id: `osm:relation/${rel.id}`, name: nameFromTags(rel.tags), ...area },
    });
  }
  return { type: 'FeatureCollection', features };
}
