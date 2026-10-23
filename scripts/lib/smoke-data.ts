/**
 * Pure dataset checks used by scripts/smoke.ts: manifest integrity, place and
 * graph invariants, and real search/routing probes. Inputs are parsed records
 * or a `read(path)` callback, so tests can run them on fixtures.
 */
import { createHash } from 'node:crypto';
import { DATA_SCHEMA_VERSION } from '../../src/data/schema.ts';
import type { GraphFile, Manifest, Place } from '../../src/data/schema.ts';
import { createRouter } from '../../src/routing/index.ts';
import type { RouteOk } from '../../src/routing/index.ts';
import { createSearchIndex, docsFromPlaces, PLACE_DOC_PREFIX } from '../../src/search/index.ts';

export const sha256Hex = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex');

/** Problems when a schemaVersion value is not the one this app build expects. */
export function checkSchemaVersion(value: unknown): string[] {
  return value === DATA_SCHEMA_VERSION
    ? []
    : [
        `data manifest schemaVersion is ${JSON.stringify(value)}, but the app expects ${DATA_SCHEMA_VERSION}.`,
      ];
}

/**
 * Every manifest file must exist under the data dir with the recorded byte
 * size and sha256. `read` returns null for a missing file.
 */
export function checkDataFiles(manifest: Manifest, read: (path: string) => Uint8Array | null): string[] {
  const problems: string[] = [];
  const entries = Object.entries(manifest.files);
  if (entries.length === 0) problems.push('data manifest lists no files.');
  for (const [key, file] of entries) {
    const bytes = read(file.path);
    if (bytes === null) {
      problems.push(`data/${file.path} (${key}) is missing.`);
      continue;
    }
    if (bytes.byteLength !== file.bytes) {
      problems.push(`data/${file.path} is ${bytes.byteLength} bytes; manifest says ${file.bytes}.`);
    }
    const actual = sha256Hex(bytes);
    if (actual !== file.sha256) {
      problems.push(
        `data/${file.path} sha256 ${actual.slice(0, 12)}… does not match manifest ${file.sha256.slice(0, 12)}….`,
      );
    }
  }
  return problems;
}

/** Place-level invariants: unique ids, and at least one named place to search for. */
export function checkPlaceInvariants(places: readonly Place[]): string[] {
  const problems: string[] = [];
  if (places.length === 0) problems.push('places.json contains no places.');
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const p of places) {
    if (seen.has(p.id)) dupes.add(p.id);
    seen.add(p.id);
  }
  if (dupes.size > 0) problems.push(`duplicate place ids: ${[...dupes].slice(0, 5).join(', ')}.`);
  if (!places.some((p) => p.name !== null)) problems.push('places.json has no named place.');
  return problems;
}

/** Graph invariants: edges reference existing nodes, places reference existing nodes. */
export function checkGraphInvariants(graph: GraphFile, places: readonly Place[]): string[] {
  const problems: string[] = [];
  const n = graph.nodes.length;
  if (n === 0) problems.push('graph.json has no nodes.');
  if (graph.edges.length === 0) problems.push('graph.json has no edges.');
  const badEdges = graph.edges.filter((e) => e.from >= n || e.to >= n);
  if (badEdges.length > 0) {
    problems.push(
      `${badEdges.length} graph edge(s) reference missing nodes (e.g. edge ${badEdges[0]?.id}: ${badEdges[0]?.from}→${badEdges[0]?.to}, ${n} nodes).`,
    );
  }
  const edgeIds = new Set(graph.edges.map((e) => e.id));
  if (edgeIds.size !== graph.edges.length) problems.push('graph.json has duplicate edge ids.');
  const badPlaces = places.filter((p) => p.graphNodeId !== undefined && p.graphNodeId >= n);
  if (badPlaces.length > 0) {
    problems.push(
      `${badPlaces.length} place(s) reference a graph node that does not exist (e.g. ${badPlaces[0]?.id}).`,
    );
  }
  return problems;
}

/**
 * A named place whose name is unique in the dataset (so the search result is
 * unambiguous). Deterministic: the lowest id wins. Null when none qualifies.
 */
export function pickSearchProbe(places: readonly Place[]): Place | null {
  const counts = new Map<string, number>();
  for (const p of places) {
    if (p.name !== null) counts.set(p.name.toLowerCase(), (counts.get(p.name.toLowerCase()) ?? 0) + 1);
  }
  const candidates = places
    .filter((p) => p.name !== null && p.name.trim() !== '' && counts.get(p.name.toLowerCase()) === 1)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return candidates[0] ?? null;
}

export interface ProbeOutcome {
  problems: string[];
  note: string;
}

/** Builds the real search index and requires the probe's own document among the results. */
export function runSearchProbe(places: Place[]): ProbeOutcome {
  const probe = pickSearchProbe(places);
  if (!probe || probe.name === null) {
    return { problems: ['no uniquely named place to probe search with.'], note: 'search probe not run' };
  }
  const index = createSearchIndex(docsFromPlaces(places));
  const hits = index.search(probe.name, { limit: 50 });
  const rank = hits.findIndex((h) => h.doc.id === `${PLACE_DOC_PREFIX}${probe.id}`);
  if (rank < 0) {
    return {
      problems: [`search for "${probe.name}" (${probe.id}) did not return that place (${hits.length} hits).`],
      note: `index size ${index.size}`,
    };
  }
  return {
    problems: [],
    note: `"${probe.name}" → ${probe.id} at rank ${rank + 1} of ${hits.length} (index ${index.size} docs)`,
  };
}

/** Places the router can start from: a location and a snapped graph node. */
export function routablePlaces(places: readonly Place[]): Place[] {
  return places
    .filter((p) => p.location !== null && p.graphNodeId !== undefined)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Routes a walking trip between real places with the production router. Tries
 * pairs in deterministic order (up to `maxAttempts`) because some places sit
 * on disconnected graph components; one valid route is enough to pass.
 */
export function runRouteProbe(graph: GraphFile, places: readonly Place[], maxAttempts = 50): ProbeOutcome {
  const candidates = routablePlaces(places);
  if (candidates.length < 2) {
    return {
      problems: ['fewer than two routable places (location + graph node).'],
      note: 'route probe not run',
    };
  }
  const router = createRouter(graph);
  const endpoint = (p: Place) => ({
    kind: 'place' as const,
    placeId: p.id,
    label: p.displayName,
    location: p.location as [number, number],
    nodeId: p.graphNodeId,
  });
  const reasons = new Map<string, number>();
  let attempts = 0;
  let firstFrom = '';
  // Origins from the start of the list, destinations from the far end, so a
  // single disconnected origin cannot fail the probe on its own.
  for (let a = 0; a < Math.min(10, candidates.length) && attempts < maxAttempts; a += 1) {
    const stop = Math.max(a, candidates.length - 6);
    for (let b = candidates.length - 1; b > stop && attempts < maxAttempts; b -= 1) {
      const from = candidates[a] as Place;
      const to = candidates[b] as Place;
      if (firstFrom === '') firstFrom = from.id;
      attempts += 1;
      const r = router.route({ from: endpoint(from), to: endpoint(to), profile: 'walk' });
      if (r.ok) {
        const problem = describeBadRoute(r);
        if (problem) return { problems: [`${from.id} → ${to.id}: ${problem}`], note: '' };
        return {
          problems: [],
          note: `${from.displayName} → ${to.displayName}: ${Math.round(r.distanceM)} m, ${r.coordinates.length} points (attempt ${attempts})`,
        };
      }
      reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
    }
  }
  const summary = [...reasons.entries()].map(([k, v]) => `${k} ×${v}`).join(', ');
  return {
    problems: [`no walking route found in ${attempts} attempts starting at ${firstFrom} (${summary}).`],
    note: '',
  };
}

function describeBadRoute(r: RouteOk): string | null {
  if (r.coordinates.length < 2) return 'route has fewer than two coordinates.';
  if (!(r.distanceM > 0) || !Number.isFinite(r.distanceM)) return `route distance is ${r.distanceM}.`;
  if (r.steps.length === 0) return 'route has no steps.';
  return null;
}
