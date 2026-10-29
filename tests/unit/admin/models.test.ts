/** Pure admin models: queue filters/actions, place form bodies, locations, overrides, audit, access points. */
import { describe, expect, it } from 'vitest';
import { REVERTABLE_ACTIONS as SERVER_REVERTABLE } from '../../../server/domain/revert.ts';
import { accessPointBody } from '../../../src/admin/map/access-choice.ts';
import { accessCandidates, accessProblem } from '../../../src/admin/map/access-points.ts';
import { nudge, pointHandle, pointPreview, roundLngLat } from '../../../src/admin/map/preview.ts';
import { createLocalProjection, haversineM } from '../../../src/distance/geodesic.ts';
import {
  approveCorrections,
  emptyPlaceForm,
  locationPatch,
  placeFormDirty,
  placeFormFromLocation,
  placeFormFromSuggestion,
  validatePlaceForm,
} from '../../../src/admin/forms/place-form.ts';
import {
  canRevert,
  displayValue,
  entityRoute,
  fieldChanges,
  parseAuditFilters,
  auditFiltersQuery,
  REVERTABLE_ACTIONS,
} from '../../../src/admin/sections/audit/audit-model.ts';
import {
  filterLocations,
  locationFiltersQuery,
  locationNear,
  parseLocationFilters,
} from '../../../src/admin/sections/locations/locations-model.ts';
import {
  filterOverrides,
  overridePutBody,
  overrideSummary,
  parseOverrideTab,
  searchBasePlaces,
} from '../../../src/admin/sections/overrides/overrides-model.ts';
import {
  apiQuery,
  DEFAULT_FILTERS,
  moderationActions,
  parseQueueFilters,
  queueFiltersQuery,
} from '../../../src/admin/sections/queue/queue-model.ts';
import { suggestionEditBody } from '../../../src/admin/sections/queue/suggestion-edit.ts';
import { issueFieldErrors } from '../../../src/admin/ui/form-errors.ts';
import type { AuditEvent, OverrideView } from '../../../src/admin/api/schemas.ts';
import type { GraphFile, Place } from '../../../src/data/schema.ts';
import { T } from '../building-studio/fixtures.ts';
import { location, suggestion, TARGET } from './fetch-mock.ts';

describe('queue model', () => {
  it('defaults to the pending queue, oldest first, and ignores unknown values', () => {
    expect(parseQueueFilters({})).toEqual(DEFAULT_FILTERS);
    expect(parseQueueFilters({ status: 'nope', category: 'not-a-category', sort: 'x' })).toEqual(
      DEFAULT_FILTERS,
    );
    expect(
      parseQueueFilters({ status: 'all', category: 'water', q: '  tea  ', sort: 'created_desc' }),
    ).toEqual({
      status: 'all',
      category: 'water',
      q: 'tea',
      sort: 'created_desc',
    });
  });

  it('round-trips filters through the URL, leaving defaults out', () => {
    expect(queueFiltersQuery(DEFAULT_FILTERS)).toEqual({});
    const f = { status: 'rejected' as const, category: 'water', q: 'tea', sort: 'created_desc' as const };
    expect(parseQueueFilters(queueFiltersQuery(f))).toEqual(f);
  });

  it('builds the API query (no status for "all", cursor when paging)', () => {
    expect(apiQuery({ ...DEFAULT_FILTERS, status: 'all' }, 'c1')).toEqual({
      sort: 'created_asc',
      limit: 25,
      cursor: 'c1',
    });
    expect(apiQuery(DEFAULT_FILTERS)).toMatchObject({ status: 'pending' });
  });

  it('offers exactly the actions the server allows for each state', () => {
    expect(moderationActions('pending')).toEqual(['edit', 'approve', 'request-info', 'reject', 'duplicate']);
    expect(moderationActions('needs_information')).toEqual([
      'edit',
      'approve',
      'reject',
      'duplicate',
      'reopen',
    ]);
    expect(moderationActions('rejected')).toEqual(['reopen']);
    expect(moderationActions('duplicate')).toEqual(['reopen']);
    expect(moderationActions('approved')).toEqual([]);
  });
});

describe('suggestion edit body', () => {
  const s = suggestion({ description: 'old', landmark: 'gate' });
  const values = {
    name: s.name,
    categoryId: s.categoryId,
    lat: String(s.location[1]),
    lon: String(s.location[0]),
    description: 'old',
    landmark: '',
    evidenceUrl: '',
    details: '',
  };
  it('sends only changes; a cleared optional field becomes null', () => {
    const r = suggestionEditBody(s, { ...values, name: 'Photocopy centre' });
    expect(r).toEqual({
      ok: true,
      body: { revision: 1, fields: { name: 'Photocopy centre', landmark: null } },
    });
  });
  it('validates with the public schema', () => {
    const r = suggestionEditBody(s, { ...values, name: 'x', evidenceUrl: 'ftp://x', lat: 'abc' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['evidenceUrl', 'location', 'name']);
  });
});

describe('place form', () => {
  it('validates exactly like the server (required name/category/position; empty optional text is absent)', () => {
    const empty = validatePlaceForm(emptyPlaceForm());
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(Object.keys(empty.errors).sort()).toEqual(['categoryId', 'location', 'name']);
    const ok = validatePlaceForm({ ...emptyPlaceForm([75.7, 31.25]), name: 'Kiosk', categoryId: 'water' });
    expect(ok).toEqual({
      ok: true,
      fields: {
        name: 'Kiosk',
        categoryId: 'water',
        location: [75.7, 31.25],
        wheelchair: 'unknown',
        verificationStatus: 'unverified',
      },
    });
    const bad = validatePlaceForm({
      ...emptyPlaceForm([75.7, 31.25]),
      name: 'K',
      categoryId: 'water',
      website: 'x',
      lastVerifiedAt: '24/10/2026',
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(['lastVerifiedAt', 'name', 'website']);
  });

  it('PATCH carries only changed fields; cleared optional text is null', () => {
    const rec = location({ description: 'Old text', website: 'https://example.org' });
    const form = placeFormFromLocation(rec);
    const v = validatePlaceForm({ ...form, name: 'New name', description: '', location: [75.7033, 31.2533] });
    expect(v.ok).toBe(true);
    if (v.ok)
      expect(locationPatch(rec, v.fields)).toEqual({
        name: 'New name',
        description: null,
        location: [75.7033, 31.2533],
      });
    const same = validatePlaceForm(form);
    if (same.ok) expect(locationPatch(rec, same.fields)).toEqual({});
  });

  it('approval corrections: nothing when approved as submitted, else only differences and additions', () => {
    const s = suggestion({ description: 'Tea' });
    const asIs = validatePlaceForm(placeFormFromSuggestion(s));
    if (asIs.ok) expect(approveCorrections(s, asIs.fields)).toBeUndefined();
    const changed = validatePlaceForm({
      ...placeFormFromSuggestion(s),
      categoryId: 'water',
      openingHours: 'Mo-Fr 09:00-17:00',
      verificationStatus: 'verified',
      location: [75.7031, 31.2534],
    });
    if (changed.ok)
      expect(approveCorrections(s, changed.fields)).toEqual({
        categoryId: 'water',
        location: [75.7031, 31.2534],
        openingHours: 'Mo-Fr 09:00-17:00',
        verificationStatus: 'verified',
      });
  });

  it('detects unsaved changes', () => {
    const a = placeFormFromLocation(location());
    expect(placeFormDirty(a, { ...a })).toBe(false);
    expect(placeFormDirty(a, { ...a, location: [1, 2] })).toBe(true);
    expect(placeFormDirty(a, { ...a, wheelchair: 'yes' })).toBe(true);
  });

  it('maps server issues onto fields', () => {
    expect(
      issueFieldErrors([
        { path: 'fields.name', message: 'Too short' },
        { path: 'accessPoint.nodeId', message: 'Path node 9 is 80 m from the location' },
      ]),
    ).toEqual({ name: 'Too short', accessPoint: 'Path node 9 is 80 m from the location' });
  });
});

// A tiny graph: node 0 and 1 joined by a walkable edge, node 2 only by a non-walkable one, node 3 far away.
const graph: Pick<GraphFile, 'nodes' | 'edges'> = {
  nodes: [
    [75.7, 31.25],
    [75.7002, 31.25],
    [75.7001, 31.2501],
    [75.71, 31.26],
  ],
  edges: [
    {
      id: 0,
      from: 0,
      to: 1,
      lengthM: 19,
      highway: 'footway',
      foot: true,
      bicycle: 'no',
      steps: false,
      wheelchair: 'yes',
      onewayBicycle: false,
    },
    {
      id: 1,
      from: 2,
      to: 3,
      lengthM: 900,
      highway: 'trunk',
      foot: false,
      bicycle: 'ride',
      steps: false,
      wheelchair: 'unknown',
      onewayBicycle: false,
    },
  ] as GraphFile['edges'],
};

describe('access points', () => {
  it('offers only existing, walkable nodes within the server limit, nearest first', () => {
    const c = accessCandidates(graph, [75.70015, 31.25]);
    expect(c.map((x) => x.nodeId)).toEqual([1, 0]);
    expect(c[0]!.distanceM).toBeLessThan(c[1]!.distanceM);
    expect(accessCandidates(graph, [75.8, 31.3])).toEqual([]);
    expect(accessCandidates(graph, [75.7, 31.25], { limit: 1 })).toHaveLength(1);
  });

  it('reports why a stored node is not valid at a position', () => {
    expect(accessProblem(graph, 0, [75.7, 31.25])).toBeNull();
    expect(accessProblem(graph, 2, [75.7001, 31.2501])).toMatch(/not on any walkable path/);
    expect(accessProblem(graph, 99, [75.7, 31.25])).toMatch(/does not exist/);
    expect(accessProblem(graph, 0, [75.71, 31.26])).toMatch(/must be within 60 m/);
  });

  it('turns the owner choice into the request field (never a guess)', () => {
    expect(accessPointBody({ kind: 'unset' })).toBeUndefined();
    expect(accessPointBody({ kind: 'keep' })).toBeUndefined();
    expect(accessPointBody({ kind: 'none' })).toBeNull();
    expect(accessPointBody({ kind: 'node', nodeId: 4, note: '  ' })).toEqual({ nodeId: 4 });
    expect(accessPointBody({ kind: 'node', nodeId: 4, note: ' North door ' })).toEqual({
      nodeId: 4,
      note: 'North door',
    });
  });
});

describe('map preview helpers', () => {
  it('draws the edited point, guides, candidates and the chosen access line', () => {
    const fc = pointPreview({
      point: [75.7, 31.25],
      others: [{ id: 'own:a', position: [75.701, 31.251] }],
      candidates: [
        { nodeId: 1, position: [75.7002, 31.25], distanceM: 19 },
        { nodeId: 0, position: [75.7, 31.2501], distanceM: 11 },
      ],
      selectedNodeId: 1,
    });
    expect(fc.features.map((f) => `${f.properties.role}:${f.properties.id}`)).toEqual([
      'guide:own:a',
      'snap:node:1',
      'snap:access:1',
      'path:node:0',
      'point:edited',
    ]);
    expect(pointPreview({ point: null }).features).toEqual([]);
    expect(pointHandle(null)).toEqual([]);
    expect(pointHandle([1, 2])[0]).toMatchObject({ id: 'move', kind: 'move', position: [1, 2] });
  });

  it('nudges by metres and rounds to 7 decimals', () => {
    const p = nudge([75.7, 31.25], 0, 1);
    expect(p[0]).toBe(75.7);
    // The shared local projection (src/distance), not a private metres-per-degree constant.
    expect(p).toEqual(roundLngLat(createLocalProjection([75.7, 31.25]).toLngLat([0, 1])));
    expect(haversineM([75.7, 31.25], nudge([75.7, 31.25], 3, -4))).toBeCloseTo(5, 1);
    expect(roundLngLat([1.123456789, 2.987654321])).toEqual([1.1234568, 2.9876543]);
  });
});

describe('locations model', () => {
  const items = [
    location({ id: 'own:b', name: 'Bakery', status: 'active' }),
    location({
      id: 'com:a',
      name: 'Água stall',
      origin: 'community',
      status: 'hidden',
      location: [75.71, 31.26],
    }),
  ];
  it('filters by status, origin and accent-insensitive name; sorted by name', () => {
    expect(filterLocations(items, parseLocationFilters({})).map((l) => l.id)).toEqual(['com:a', 'own:b']);
    expect(filterLocations(items, parseLocationFilters({ status: 'hidden' })).map((l) => l.id)).toEqual([
      'com:a',
    ]);
    expect(filterLocations(items, parseLocationFilters({ origin: 'owner' })).map((l) => l.id)).toEqual([
      'own:b',
    ]);
    expect(filterLocations(items, parseLocationFilters({ q: 'agua' })).map((l) => l.id)).toEqual(['com:a']);
    expect(locationFiltersQuery(parseLocationFilters({ status: 'x', origin: 'community' }))).toEqual({
      origin: 'community',
    });
  });
  it('picks the location near a map click only within the radius', () => {
    expect(locationNear(items, [75.7032, 31.2533])?.id).toBe('own:b');
    expect(locationNear(items, [75.705, 31.255])).toBeNull();
  });
});

const view = (over: Partial<OverrideView> = {}): OverrideView => ({
  targetId: TARGET,
  fields: {},
  hidden: false,
  accessNodeId: null,
  accessNote: null,
  note: null,
  baseDatasetVersion: 'v1',
  updatedBy: 'owner',
  updatedAt: T,
  revision: 2,
  orphan: false,
  orphanReason: null,
  baseName: 'Block A',
  ...over,
});

const place = (over: Partial<Place> = {}): Place =>
  ({
    id: TARGET,
    name: 'Block A',
    displayName: 'Block A',
    aliases: ['Admin block'],
    categoryId: 'academic',
    kind: 'building',
    location: [75.7, 31.25],
    campusZone: 'on-campus',
    wheelchair: 'unknown',
    provenance: { sourceId: 'osm', sourceRef: 'way/1', verificationStatus: 'imported' },
    ...over,
  }) as Place;

describe('overrides model', () => {
  it('summarises what an override changes, orphans first', () => {
    expect(overrideSummary(view())).toEqual(['No changes recorded']);
    expect(
      overrideSummary(
        view({
          hidden: true,
          fields: { name: 'X', categoryId: 'water', openingHours: '24/7' },
          accessNodeId: 7,
          orphan: true,
          orphanReason: 'context-layer',
        }),
      ),
    ).toEqual([
      'Now an off-campus place',
      'Hidden from the public map',
      'Renamed to “X”',
      'Category: Drinking water',
      'Also changes: openingHours',
      'Owner access point (path node 7)',
    ]);
  });

  it('tabs: all, hidden, orphans', () => {
    const items = [
      view({ targetId: 'a', hidden: true }),
      view({ targetId: 'b', orphan: true }),
      view({ targetId: 'c' }),
    ];
    expect(filterOverrides(items, 'hidden').map((o) => o.targetId)).toEqual(['a']);
    expect(filterOverrides(items, 'orphans').map((o) => o.targetId)).toEqual(['b']);
    expect(filterOverrides(items, parseOverrideTab({ tab: 'bogus' }))).toHaveLength(3);
  });

  it('searches campus places by name, alias or id (prefix matches first)', () => {
    const ps = [
      place(),
      place({ id: 'cur:b', name: 'Library', displayName: 'Library', aliases: ['Block A library'] }),
    ];
    expect(searchBasePlaces(ps, 'b').length).toBe(0);
    expect(searchBasePlaces(ps, 'block').map((p) => p.id)).toEqual([TARGET, 'cur:b']);
    expect(searchBasePlaces(ps, 'way/12').map((p) => p.id)).toEqual([TARGET]);
  });

  it('PUT carries over fields this screen does not edit; base-equal or empty values are dropped', () => {
    const o = view({ fields: { name: 'Old', openingHours: '24/7' }, note: 'private', revision: 3 });
    expect(
      overridePutBody(
        place(),
        o,
        { name: 'Block A', categoryId: '', hidden: true, note: 'private' },
        undefined,
      ),
    ).toEqual({
      revision: 3,
      fields: { openingHours: '24/7' },
      hidden: true,
    });
    expect(
      overridePutBody(
        place(),
        null,
        { name: ' Main Block ', categoryId: 'library', hidden: false, note: '' },
        { nodeId: 5 },
      ),
    ).toEqual({
      revision: null,
      fields: { name: 'Main Block', categoryId: 'library' },
      hidden: false,
      accessPoint: { nodeId: 5 },
    });
    expect(
      overridePutBody(place(), o, { name: '', categoryId: '', hidden: false, note: '' }, null),
    ).toMatchObject({
      accessPoint: null,
      note: '',
    });
  });
});

const event = (over: Partial<AuditEvent> = {}): AuditEvent => ({
  id: 1,
  at: T,
  actor: 'owner',
  action: 'location.update',
  entityType: 'location',
  entityId: 'own:x',
  before: null,
  after: null,
  outcome: 'success',
  detail: null,
  ...over,
});

describe('audit model', () => {
  it('mirrors the server list of revertable actions exactly', () => {
    expect([...REVERTABLE_ACTIONS].sort()).toEqual([...SERVER_REVERTABLE].sort());
    expect(canRevert(event())).toBe(true);
    expect(canRevert(event({ outcome: 'rejected' }))).toBe(false);
    expect(canRevert(event({ action: 'suggestion.approve' }))).toBe(false);
  });

  it('lists field changes (nested override fields expanded, bookkeeping ignored)', () => {
    expect(
      fieldChanges(
        { name: 'A', revision: 1, updatedAt: 'x', fields: { name: 'A' }, hidden: false },
        { name: 'B', revision: 2, updatedAt: 'y', fields: { name: 'B', categoryId: 'water' }, hidden: false },
      ),
    ).toEqual([
      { field: 'fields.categoryId', before: undefined, after: 'water' },
      { field: 'fields.name', before: 'A', after: 'B' },
      { field: 'name', before: 'A', after: 'B' },
    ]);
    expect(fieldChanges(null, { a: 1 })).toEqual([{ field: 'a', before: undefined, after: 1 }]);
  });

  it('displays values plainly', () => {
    expect(displayValue(undefined)).toBe('—');
    expect(displayValue(null)).toBe('empty');
    expect(displayValue([75.7, 31.25])).toBe('31.250000, 75.700000');
    expect(displayValue({ a: 1 })).toBe('{"a":1}');
  });

  it('links events to their record and round-trips filters', () => {
    expect(entityRoute(event())).toEqual({ section: 'locations', id: 'own:x' });
    expect(entityRoute(event({ entityType: 'session' }))).toBeNull();
    expect(entityRoute(event({ entityType: 'override', entityId: TARGET }))).toEqual({
      section: 'overrides',
      id: TARGET,
    });
    const f = parseAuditFilters({ entity: 'override', entityId: TARGET, action: 'override.put' });
    expect(parseAuditFilters(auditFiltersQuery(f))).toEqual(f);
    expect(parseAuditFilters({ entity: 'bogus' }).entity).toBeNull();
  });
});
