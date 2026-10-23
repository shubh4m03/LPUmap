/**
 * createDirectory: pure, derived only from the records passed in. Nothing is
 * invented: titles come from source names or the app's own map keys, and every
 * fact keeps its provenance.
 */
import type { BuildingProps, Place, Provenance } from '../data/schema.ts';
import {
  ROUTABILITY_NOTES,
  type CampusDirectory,
  type DirectoryEntry,
  type DirectoryInput,
  type RoutabilityReason,
} from './types.ts';

/** Lower-case, strip diacritics, collapse everything but letters/digits to single spaces. */
export function normalizeDirectoryText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

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
    if (!p.inCampusInventory || seen.has(p.id)) continue;
    if (p.campusStatus !== 'inside' && p.campusStatus !== 'crossing') continue;
    seen.add(p.id);
    const place = placesById.get(p.id);
    const reason = routability(place);
    entries.push({
      id: p.id,
      key: p.directoryKey,
      cell: p.directoryCell,
      title: p.name ?? (p.directoryKey ? `Building ${p.directoryKey}` : p.displayName),
      subtitle: subtitleFor(p),
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
  const haystacks = new Map(
    entries.map((e) => [
      e.id,
      normalizeDirectoryText(
        [e.title, e.displayName, e.name ?? '', e.key ?? '', e.officialBlock?.label ?? ''].join(' '),
      ),
    ]),
  );

  return {
    entries,
    byKey,
    byId,
    search(query) {
      const q = normalizeDirectoryText(query);
      if (q === '') return [];
      const tokens = q.split(' ');
      const exactKey = byKey.get(query.trim().toUpperCase());
      const rank = (e: DirectoryEntry) =>
        e === exactKey ? 0 : normalizeDirectoryText(e.title).startsWith(q) ? 1 : 2;
      return entries
        .filter((e) => e === exactKey || tokens.every((t) => haystacks.get(e.id)!.includes(t)))
        .map((e, i) => ({ e, i, r: rank(e) }))
        .sort((a, b) => a.r - b.r || a.i - b.i)
        .map((x) => x.e);
    },
    filter(categoryIds) {
      if (categoryIds.length === 0) return [...entries];
      const wanted = new Set(categoryIds);
      return entries.filter((e) => wanted.has(e.categoryId));
    },
  };
}
