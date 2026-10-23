// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { Place } from '../../../src/data/schema.ts';
import type { PlaceRecord } from '../../../scripts/lib/build-places.ts';
import { CuratedDataError, loadCurated, mergeCurated } from '../../../scripts/lib/curated.ts';
import type { CuratedInputs } from '../../../scripts/lib/curated.ts';

const FIXTURE_DIR = new URL('../../fixtures/osm/synthetic-curated/', import.meta.url);

function osmPlace(id: string, extra: Partial<Place> = {}): PlaceRecord {
  return {
    geometry: 'area',
    place: {
      id,
      name: null,
      displayName: 'Unnamed building',
      aliases: [],
      categoryId: 'building',
      kind: 'building',
      location: [75.7, 31.25],
      buildingId: id,
      campusZone: 'on-campus',
      wheelchair: 'unknown',
      graphNodeId: 7,
      connectorLengthM: 3.5,
      provenance: { sourceId: 'osm', sourceRef: id.slice(4), verificationStatus: 'imported' },
      ...extra,
    },
  };
}

const empty = (): CuratedInputs => ({
  aliases: { aliases: [] },
  overrides: { overrides: [] },
  organizations: { records: [] },
  present: [],
});
const src = { name: 'Synthetic source', url: 'https://example.org/s', retrievedAt: '2026-01-01' };

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function curatedDir(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'curated-'));
  tmpDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

describe('loadCurated', () => {
  it('treats missing files as empty lists', () => {
    const c = loadCurated(curatedDir({}));
    expect(c).toEqual({ ...empty(), present: [] });
  });

  it('loads and validates the synthetic fixture', () => {
    const c = loadCurated(fileURLToPath(FIXTURE_DIR));
    expect(c.present).toEqual(['aliases.json', 'overrides.json', 'organizations.json']);
    expect(c.organizations.records).toHaveLength(2);
  });

  it('collects every schema problem with file and path', () => {
    const dir = curatedDir({
      'aliases.json': { aliases: [{ target: 'way/1', aliases: [], source: { name: 'x' } }] },
      'overrides.json': '{ not json',
    });
    try {
      loadCurated(dir);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CuratedDataError);
      const problems = (e as CuratedDataError).problems.join('\n');
      expect(problems).toMatch(/aliases\.json: aliases\.0\.target/);
      expect(problems).toMatch(/aliases\.json: aliases\.0\.aliases/);
      expect(problems).toMatch(/aliases\.json: aliases\.0\.source\.url/);
      expect(problems).toMatch(/overrides\.json: not valid JSON/);
    }
  });

  it('requires an override to state how it was checked and to change something', () => {
    const dir = curatedDir({
      'overrides.json': {
        overrides: [{ target: 'osm:way/1', set: {}, source: { name: 's' }, lastVerifiedAt: '2026-01-01' }],
      },
    });
    expect(() => loadCurated(dir)).toThrow(
      /check[\s\S]*set must change at least one field|set must change[\s\S]*check/,
    );
  });
});

describe('mergeCurated', () => {
  it('adds sourced aliases without duplicating the name', () => {
    const c = empty();
    c.aliases.aliases.push({ target: 'osm:way/1', aliases: ['Block X', 'block x', 'Old'], source: src });
    const r = mergeCurated(
      [osmPlace('osm:way/1', { name: 'Old', displayName: 'Old', aliases: ['Older'] })],
      c,
    );
    expect(r.records[0]!.place.aliases).toEqual(['Block X', 'Older']);
    expect(r.sources).toEqual([
      {
        id: 'curated:example-org-s',
        name: 'Synthetic source',
        url: 'https://example.org/s',
        retrievedAt: '2026-01-01',
      },
    ]);
  });

  it('marks overrides verified only for physical or official checks', () => {
    const c = empty();
    c.overrides.overrides.push(
      {
        target: 'osm:way/1',
        set: { name: 'Admin Block', wheelchair: 'limited' },
        source: { name: 'Survey' },
        check: 'physical-survey',
        lastVerifiedAt: '2026-02-01',
      },
      {
        target: 'osm:way/2',
        set: { openingHours: 'Mo-Fr 09:00-17:00' },
        source: { name: 'Tip' },
        check: 'unverified-report',
        lastVerifiedAt: '2026-02-02',
      },
    );
    const r = mergeCurated([osmPlace('osm:way/1'), osmPlace('osm:way/2')], c);
    const [a, b] = r.records.map((x) => x.place);
    expect(a).toMatchObject({ name: 'Admin Block', displayName: 'Admin Block', wheelchair: 'limited' });
    expect(a!.provenance).toMatchObject({
      verificationStatus: 'verified',
      lastVerifiedAt: '2026-02-01',
      sourceId: 'osm',
    });
    expect(b).toMatchObject({ openingHours: 'Mo-Fr 09:00-17:00' });
    expect(b!.provenance).toMatchObject({ verificationStatus: 'unverified' });
    // A report is not a check: it is dated in the notes, never as lastVerifiedAt.
    expect(b!.provenance.lastVerifiedAt).toBeUndefined();
    expect(b!.provenance.notes).toMatch(/unverified-report, 2026-02-02/);
  });

  it('anchors organizations to mapped places and leaves others unlocated', () => {
    const c = empty();
    c.organizations.records.push(
      {
        id: 'cur:dept',
        name: 'Dept',
        aliases: ['D'],
        categoryId: 'academic',
        kind: 'organization',
        anchor: { target: 'osm:way/1' },
        website: 'https://example.org',
        source: src,
        verificationStatus: 'imported',
      },
      {
        id: 'cur:office',
        name: 'Office',
        aliases: [],
        categoryId: 'other',
        kind: 'organization',
        website: 'mailto:x@y',
        source: src,
        verificationStatus: 'unverified',
      },
    );
    const r = mergeCurated([osmPlace('osm:way/1')], c);
    const dept = r.records.find((x) => x.place.id === 'cur:dept')!.place;
    const office = r.records.find((x) => x.place.id === 'cur:office')!.place;
    expect(dept).toMatchObject({
      kind: 'organization',
      location: [75.7, 31.25],
      buildingId: 'osm:way/1',
      graphNodeId: 7,
      connectorLengthM: 3.5,
    });
    expect(dept.contact).toEqual({ website: 'https://example.org' });
    expect(office).toMatchObject({ location: null, campusZone: 'on-campus' });
    expect(office.contact).toBeUndefined();
    expect(office.graphNodeId).toBeUndefined();
    expect(r.relations).toEqual([
      expect.objectContaining({
        id: 'located_in:cur:dept->osm:way/1',
        type: 'located_in',
        method: 'curated',
        inferred: false,
      }),
    ]);
    expect(r.applied).toEqual({ aliases: 0, overrides: 0, organizations: 2, anchoredOrganizations: 1 });
  });

  it('rejects unresolved anchors and targets, unknown categories and duplicate ids', () => {
    const c = empty();
    c.organizations.records.push(
      {
        id: 'cur:a',
        name: 'A',
        aliases: [],
        categoryId: 'academic',
        kind: 'organization',
        anchor: { target: 'osm:way/999' },
        source: src,
        verificationStatus: 'imported',
      },
      {
        id: 'cur:b',
        name: 'B',
        aliases: [],
        categoryId: 'nonsense',
        kind: 'organization',
        source: src,
        verificationStatus: 'imported',
      },
    );
    c.aliases.aliases.push({ target: 'osm:node/5', aliases: ['x'], source: src });
    c.overrides.overrides.push({
      target: 'osm:way/1',
      set: { categoryId: 'nope' },
      source: { name: 's' },
      check: 'official-publication',
      lastVerifiedAt: '2026-01-01',
    });
    try {
      mergeCurated([osmPlace('osm:way/1')], c);
      expect.unreachable();
    } catch (e) {
      const msg = (e as CuratedDataError).problems.join('\n');
      expect(msg).toMatch(/anchor osm:way\/999 does not resolve/);
      expect(msg).toMatch(/unknown categoryId "nonsense"/);
      expect(msg).toMatch(/target osm:node\/5 does not exist/);
      expect(msg).toMatch(/unknown categoryId "nope"/);
    }
    const dup = empty();
    dup.organizations.records.push({
      id: 'cur:x',
      name: 'X',
      aliases: [],
      categoryId: 'other',
      kind: 'organization',
      source: src,
      verificationStatus: 'imported',
    });
    dup.organizations.records.push({ ...dup.organizations.records[0]! });
    expect(() => mergeCurated([], dup)).toThrow(/duplicate place id/);
  });

  it('does not mutate the input when nothing is curated', () => {
    const rec = osmPlace('osm:way/1');
    const before = JSON.stringify(rec);
    const r = mergeCurated([rec], empty());
    expect(JSON.stringify(rec)).toBe(before);
    expect(r.sources).toEqual([]);
  });
});
