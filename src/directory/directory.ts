/**
 * createDirectory: pure, derived only from the records passed in. Nothing is
 * invented: titles come from source names or the app's own map keys, and every
 * fact keeps its provenance.
 */
import type { BuildingProps, Place, Provenance } from '../data/schema.ts';
import { artworkNumberQuery, buildArtworkLayer } from './artwork.ts';
import { normalizeDirectoryText } from './normalize.ts';
import {
  ROUTABILITY_NOTES,
  type CampusDirectory,
  type DirectoryEntry,
  type DirectoryInput,
  type DirectoryItem,
  type RoutabilityReason,
} from './types.ts';

export { normalizeDirectoryText };

const KEY_PARTS_RE = /^([A-Z])(\d{1,2})-(\d{2})$/;

/** Sort key order: column letter, row number (numeric), sequence. */
export function compareDirectoryKeys(a: string, b: string): number {
  const ma = KEY_PARTS_RE.exec(a);
  const mb = KEY_PARTS_RE.exec(b);
  if (!ma || !mb) return a < b ? -1 : a > b ? 1 : 0;
  return ma[1]!.localeCompare(mb[1]!) || Number(ma[2]) - Number(mb[2]) || Number(ma[3]) - Number(mb[3]);
}

function routability(place: Place | undefined): RoutabilityReason {
  if (!place) return 'no-place-record';
  if (place.location === null) return 'no-location';
  if (place.graphNodeId === undefined) return 'not-connected';
  return 'routable';
}

function provenanceFromProps(p: BuildingProps): Provenance {
  return {
    sourceId: p.sourceId,
    sourceRef: p.sourceRef,
    ...(p.retrievedAt !== null ? { retrievedAt: p.retrievedAt } : {}),
    ...(p.lastVerifiedAt !== null ? { lastVerifiedAt: p.lastVerifiedAt } : {}),
    verificationStatus: p.verificationStatus,
  };
}

function subtitleFor(p: BuildingProps): string {
  if (p.name !== null) return p.directoryKey ? `Map key ${p.directoryKey}` : 'No map key yet';
  return p.displayName;
}

/** True when a building feature becomes a directory entry (campus inventory, inside or crossing, not excluded). */
function eligible(p: BuildingProps, exclude: ReadonlySet<string> | undefined): boolean {
  return (
    p.inCampusInventory &&
    (p.campusStatus === 'inside' || p.campusStatus === 'crossing') &&
    !(exclude?.has(p.id) ?? false)
  );
}

/**
 * Ids of the buildings createDirectory lists for this input: the building set
 * artwork associations are checked against (mergeArtworkAssociations
 * `buildingExists`), so a verified join or an unconfirmed candidate always
 * resolves to exactly one directory entry.
 */
export function directoryBuildingIds(input: Pick<DirectoryInput, 'buildings' | 'exclude'>): Set<string> {
  const ids = new Set<string>();
  for (const f of input.buildings.features)
    if (eligible(f.properties, input.exclude)) ids.add(f.properties.id);
  return ids;
}

export function createDirectory(input: DirectoryInput): CampusDirectory {
  const placesById = new Map<string, Place>();
  for (const p of input.places) if (!placesById.has(p.id)) placesById.set(p.id, p);

  const facilities = new Map<string, Set<string>>();
  const organizations = new Map<string, Set<string>>();
  for (const r of input.relations) {
    if (r.type !== 'located_in' && r.type !== 'part_of') continue;
    const from = placesById.get(r.from);
    if (!from || r.from === r.to) continue;
    const target = from.kind === 'organization' ? organizations : facilities;
    const set = target.get(r.to) ?? new Set<string>();
    set.add(r.from);
    target.set(r.to, set);
  }

  const seen = new Set<string>();
  const entries: DirectoryEntry[] = [];
  for (const f of input.buildings.features) {
    const p = f.properties;
    if (seen.has(p.id) || !eligible(p, input.exclude)) continue;
    if (p.campusStatus !== 'inside' && p.campusStatus !== 'crossing') continue;
    seen.add(p.id);
    const place = placesById.get(p.id);
    const reason = routability(place);
    entries.push({
      id: p.id,
      key: p.directoryKey,
      cell: p.directoryCell,
      title: p.name ?? (p.directoryKey ? `Building ${p.directoryKey}` : p.displayName),
      // An owner-placed studio building carries its public S3 label (e.g. 'Illustrative model … not verified').
      subtitle: p.geometrySource === 'studio' ? (place?.provenance.notes ?? p.displayName) : subtitleFor(p),
      name: p.name,
      displayName: p.displayName,
      officialBlock:
        p.officialBlockLabel !== null && p.officialBlockSourceId !== null
          ? { label: p.officialBlockLabel, sourceId: p.officialBlockSourceId }
          : null,
      categoryId: p.categoryId,
      campusStatus: p.campusStatus,
      insideFraction: p.insideFraction,
      location: [p.anchorLon, p.anchorLat],
      footprint: { file: 'buildings.geojson', featureId: p.id },
      areaM2: p.areaM2,
      levels: p.levels,
      renderHeightM: p.renderHeightM,
      renderHeightSource: p.renderHeightSource,
      facilityIds: [...(facilities.get(p.id) ?? [])].sort(),
      organizationIds: [...(organizations.get(p.id) ?? [])].sort(),
      routable: reason === 'routable',
      routableReason: reason,
      routableNote: ROUTABILITY_NOTES[reason],
      provenance: place?.provenance ?? provenanceFromProps(p),
      artwork: [],
      unconfirmedArtwork: [],
    });
  }
  entries.sort((a, b) => {
    if (a.key && b.key) return compareDirectoryKeys(a.key, b.key);
    if (a.key) return -1;
    if (b.key) return 1;
    return a.title.localeCompare(b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });

  const byKey = new Map<string, DirectoryEntry>();
  const byId = new Map<string, DirectoryEntry>();
  for (const e of entries) {
    byId.set(e.id, e);
    if (e.key) byKey.set(e.key, e);
  }

  // The illustration layer: a verified subject becomes part of its building's one entry.
  const layer = input.artwork ? buildArtworkLayer(input.artwork, (id) => byId.get(id)) : null;
  if (layer) {
    for (const e of entries) {
      e.artwork = layer.links.get(e.id) ?? [];
      e.unconfirmedArtwork = layer.pointers.get(e.id) ?? [];
    }
  }

  const haystacks = new Map(
    entries.map((e) => [
      e.id,
      normalizeDirectoryText(
        [
          e.title,
          e.displayName,
          e.name ?? '',
          e.key ?? '',
          e.officialBlock?.label ?? '',
          ...(layer?.joinedText.get(e.id) ?? []),
        ].join(' '),
      ),
    ]),
  );

  /** Rank 0: exact map key, verified artwork number or exact verified artwork label; 1: title prefix; 2: other. */
  const ranked = (query: string): { e: DirectoryEntry; r: number }[] => {
    const q = normalizeDirectoryText(query);
    if (q === '') return [];
    const tokens = q.split(' ');
    const exactKey = byKey.get(query.trim().toUpperCase());
    const num = artworkNumberQuery(query);
    const byNumber = new Set(num !== null ? (layer?.buildingsByNumber.get(num) ?? []) : []);
    const top = (e: DirectoryEntry) =>
      e === exactKey || byNumber.has(e.id) || (layer?.joinedText.get(e.id)?.includes(q) ?? false);
    return entries
      .filter((e) => top(e) || tokens.every((t) => haystacks.get(e.id)!.includes(t)))
      .map((e, i) => ({ e, i, r: top(e) ? 0 : normalizeDirectoryText(e.title).startsWith(q) ? 1 : 2 }))
      .sort((a, b) => a.r - b.r || a.i - b.i);
  };

  return {
    entries,
    byKey,
    byId,
    search: (query) => ranked(query).map((x) => x.e),
    filter(categoryIds) {
      if (categoryIds.length === 0) return [...entries];
      const wanted = new Set(categoryIds);
      return entries.filter((e) => wanted.has(e.categoryId));
    },
    artwork: layer?.artwork ?? null,
    find(query) {
      const rows: { item: DirectoryItem; r: number; order: number }[] = ranked(query).map((x, i) => ({
        item: { kind: 'building', id: x.e.id, entry: x.e },
        r: x.r,
        order: i,
      }));
      const art = layer?.searchArtwork(query) ?? [];
      art.forEach((hit, i) =>
        rows.push({
          item: { kind: 'artwork', id: hit.entry.id, entry: hit.entry },
          r: hit.rank,
          order: rows.length + i,
        }),
      );
      return rows.sort((a, b) => a.r - b.r || a.order - b.order).map((x) => x.item);
    },
    item(id) {
      const building = byId.get(id);
      if (building) return { kind: 'building', id, entry: building };
      return layer?.artwork.subjectTarget.get(id);
    },
  };
}
