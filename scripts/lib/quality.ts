/** Data-quality report: what is missing, sparse, unverified or unroutable. */
import { getCategory } from '../../src/config/categories.ts';
import type { Place } from '../../src/data/schema.ts';
import type { BuildingRecord, SkippedFeature } from './build-buildings.ts';
import type { GraphBuildResult, GraphStats } from './build-graph.ts';

/** Categories whose absence matters to students; reported as empty/sparse. */
export const IMPORTANT_CATEGORIES = [
  'water',
  'washroom',
  'health',
  'finance',
  'printing',
  'library',
  'gate',
  'hostel',
];
export const SPARSE_THRESHOLD = 3;

interface PlaceRef {
  id: string;
  displayName: string;
}

export interface QualityReport {
  builtFrom: string;
  totals: {
    places: number;
    buildings: number;
    relations: number;
    onCampusPlaces: number;
    offCampusPlaces: number;
  };
  unnamedBuildings: {
    total: number;
    onCampus: number;
    largestOnCampus: Array<PlaceRef & { areaM2: number }>;
  };
  placesWithoutLocation: PlaceRef[];
  placesNotConnectedToGraph: Array<PlaceRef & { campusZone: string }>;
  entrances: { total: number; attached: number; unattached: string[] };
  duplicates: { ids: string[]; locations: Array<{ location: [number, number]; ids: string[] }> };
  importantCategories: Array<{
    id: string;
    label: string;
    total: number;
    onCampus: number;
    status: 'empty' | 'sparse' | 'ok';
  }>;
  verification: { byStatus: Record<string, number>; withoutLastVerifiedAt: number };
  graph: {
    nodes: number;
    edges: number;
    components: number;
    componentSizes: number[];
    largestComponentShare: number;
    footEdges: number;
    stats: GraphStats;
  };
  heightSources: Record<string, number>;
  skippedFeatures: SkippedFeature[];
  minHeightIgnored: string[];
  curated: {
    filesPresent: string[];
    aliases: number;
    overrides: number;
    organizations: number;
    anchoredOrganizations: number;
  };
  notes: string[];
}

export interface QualityInputs {
  builtFrom: string;
  places: readonly Place[];
  buildings: readonly BuildingRecord[];
  relationCount: number;
  graph: GraphBuildResult;
  unconnected: readonly string[];
  attachedEntrances: readonly string[];
  unattachedEntrances: readonly string[];
  skipped: readonly SkippedFeature[];
  minHeightIgnored: readonly string[];
  curated: QualityReport['curated'];
}

const ref = (p: Place): PlaceRef => ({ id: p.id, displayName: p.displayName });
const count = <T>(items: readonly T[], key: (t: T) => string) =>
  items.reduce<Record<string, number>>((acc, t) => ((acc[key(t)] = (acc[key(t)] ?? 0) + 1), acc), {});
const sortedRecord = (r: Record<string, number>) =>
  Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b)));

export function buildQualityReport(q: QualityInputs): QualityReport {
  const { places } = q;
  const byId = new Map(places.map((p) => [p.id, p]));
  const unnamed = q.buildings.filter((b) => b.name === null);
  const unnamedOn = unnamed.filter((b) => b.campusZone === 'on-campus');

  const idCounts = count(places, (p) => p.id);
  const dupIds = Object.keys(idCounts)
    .filter((id) => idCounts[id]! > 1)
    .sort();
  const atLocation = new Map<string, string[]>();
  for (const p of places) {
    if (!p.location || p.kind === 'building' || p.kind === 'organization' || p.kind === 'area') continue;
    const key = `${p.location[0]},${p.location[1]}`;
    atLocation.set(key, [...(atLocation.get(key) ?? []), p.id]);
  }
  const dupLocations = [...atLocation.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([k, ids]) => ({ location: k.split(',').map(Number) as [number, number], ids: ids.sort() }))
    .sort((a, b) => a.ids[0]!.localeCompare(b.ids[0]!));

  const important = IMPORTANT_CATEGORIES.map((id) => {
    const inCat = places.filter((p) => p.categoryId === id);
    const onCampus = inCat.filter((p) => p.campusZone === 'on-campus').length;
    const status: 'empty' | 'sparse' | 'ok' =
      inCat.length === 0 ? 'empty' : onCampus < SPARSE_THRESHOLD ? 'sparse' : 'ok';
    return { id, label: getCategory(id).label, total: inCat.length, onCampus, status };
  });

  const { graph, componentSizes } = q.graph;
  const notes: string[] = [];
  for (const p of places) {
    if (p.kind !== 'gate' && /\bgate\b/i.test(p.name ?? '') && p.description)
      notes.push(`${p.id} (${p.displayName}): ${p.description}`);
  }
  if (componentSizes.length > 1) {
    notes.push(
      `The walking graph has ${componentSizes.length} disconnected components; no synthetic links were added. ` +
        'Routes between components are reported as "no path" until the missing OSM connections are mapped.',
    );
  }

  return {
    builtFrom: q.builtFrom,
    totals: {
      places: places.length,
      buildings: q.buildings.length,
      relations: q.relationCount,
      onCampusPlaces: places.filter((p) => p.campusZone === 'on-campus').length,
      offCampusPlaces: places.filter((p) => p.campusZone === 'off-campus-nearby').length,
    },
    unnamedBuildings: {
      total: unnamed.length,
      onCampus: unnamedOn.length,
      largestOnCampus: [...unnamedOn]
        .sort((a, b) => b.areaM2 - a.areaM2 || a.id.localeCompare(b.id))
        .slice(0, 25)
        .map((b) => ({ id: b.id, displayName: b.displayName, areaM2: Math.round(b.areaM2) })),
    },
    placesWithoutLocation: places.filter((p) => !p.location).map(ref),
    placesNotConnectedToGraph: [...q.unconnected]
      .sort()
      .map((id) => byId.get(id))
      .filter((p): p is Place => p !== undefined)
      .map((p) => ({ ...ref(p), campusZone: p.campusZone })),
    entrances: {
      total: q.attachedEntrances.length + q.unattachedEntrances.length,
      attached: q.attachedEntrances.length,
      unattached: [...q.unattachedEntrances].sort(),
    },
    duplicates: { ids: dupIds, locations: dupLocations },
    importantCategories: important,
    verification: {
      byStatus: sortedRecord(count(places, (p) => p.provenance.verificationStatus)),
      withoutLastVerifiedAt: places.filter((p) => !p.provenance.lastVerifiedAt).length,
    },
    graph: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      components: componentSizes.length,
      componentSizes: componentSizes.slice(0, 30),
      largestComponentShare: graph.nodes.length
        ? Math.round(((componentSizes[0] ?? 0) / graph.nodes.length) * 1000) / 1000
        : 0,
      footEdges: graph.edges.filter((e) => e.foot).length,
      stats: q.graph.stats,
    },
    heightSources: sortedRecord(count(q.buildings, (b) => b.height.heightSource)),
    skippedFeatures: [...q.skipped].sort((a, b) => a.ref.localeCompare(b.ref)),
    minHeightIgnored: [...q.minHeightIgnored].sort(),
    curated: q.curated,
    notes,
  };
}
