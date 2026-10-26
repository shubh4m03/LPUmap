/**
 * Pure parts of the admin Artwork section: exact labels and titles, filters,
 * the decision form's checks (mirroring the server rules), the write body,
 * the zoom window (same transform as the image, never outside it), the
 * Studio read-only link filter, and the admin audit type for 'artwork'.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditEventSchema } from '../../../src/admin/api/schemas.ts';
import type { ArtworkAssociationView } from '../../../src/admin/api/artwork.ts';
import { entityRoute, ENTITY_LABELS, actionLabel } from '../../../src/admin/sections/audit/audit-model.ts';
import { displayAsset, zoomViewBox } from '../../../src/admin/sections/artwork/artwork-images.ts';
import {
  artworkRows,
  associationWriteBody,
  filterRows,
  formFrom,
  linksForBuildings,
  statusCounts,
  subjectLabels,
  subjectTitle,
  validateAssociationForm,
  type AssociationFormValues,
} from '../../../src/admin/sections/artwork/artwork-model.ts';
import { ADMIN_SECTIONS, ADMIN_SECTION_LABELS } from '../../../src/admin/routes.ts';
import { PROHIBITED_SOURCE_MESSAGE } from '../../../src/building-studio/text.ts';
import { isometricArtManifestSchema } from '../../../src/isometric-art/schema.ts';

const manifest = isometricArtManifestSchema.parse(
  JSON.parse(readFileSync(join(process.cwd(), 'public/isometric-art/manifest.json'), 'utf8')),
);
const subject = (id: string) => manifest.subjects.find((s) => s.subjectId === id)!;
const baseline = (id: string) => manifest.associations.find((a) => a.subjectId === id)!;

const view = (id: string, over: Partial<ArtworkAssociationView> = {}): ArtworkAssociationView => {
  const b = baseline(id);
  return {
    subjectId: id,
    baseline: b,
    decision: null,
    effective: {
      subjectId: id,
      status: b.status,
      buildingId: b.status === 'verified' ? b.buildingId : null,
      unconfirmedMatchId: b.status === 'approximate' ? b.buildingId : null,
      evidence: [],
      candidateFootprints: b.candidateFootprints,
      reason: b.reason,
      source: 'curated',
      revision: b.revision,
      updatedAt: null,
    },
    ...over,
  };
};

const TODAY = '2026-10-24';
const known = (id: string) => id === 'osm:way/422437890';
const form = (over: Partial<AssociationFormValues> = {}): AssociationFormValues => ({
  status: 'verified',
  buildingId: 'osm:way/422437890',
  evidence: [{ kind: 'site-sign', description: 'Sign reads Block 34', url: '', date: '2026-10-20' }],
  note: '',
  ...over,
});

describe('labels and titles are exact', () => {
  it('keeps printed text exactly (double spaces, typos, punctuation) and never invents a name', () => {
    expect(subjectTitle(subject('art:num-2'))).toBe('CAMPUS CAFE  & BALDEV RAJ AUDITORIUM');
    expect(subjectTitle(subject('art:num-25'))).toBe('SCHOOL OF AGRICULTURE');
    // A held caption is not used as the title.
    expect(subjectTitle(subject('art:scene-103'))).toBe('Label held for your review (art:scene-103)');
    const labels = subjectLabels(subject('art:num-25')).map((l) => [l.role, l.quote.text, l.quote.ref]);
    expect(labels).toContainEqual(['Block heading (artwork numbering)', 'BLOCK-25,26:', 'iso-art-087/L1']);
    // Every label shown is byte-equal to the manifest quote it comes from.
    for (const s of manifest.subjects)
      for (const l of subjectLabels(s))
        expect([s.displayLabel, s.visibleBlockLabel, s.artworkCategory, ...s.otherLabels]).toContainEqual(
          l.quote,
        );
  });

  it('a subject without any printed label gets a neutral non-name', () => {
    const unlabelled = manifest.subjects.find(
      (s) => s.kind === 'area' && !s.displayLabel && !s.visibleBlockLabel && !s.displayHold,
    )!;
    expect(subjectTitle(unlabelled)).toBe('Unlabelled area on the illustration');
  });
});

describe('list rows and filters', () => {
  const items = manifest.subjects.map((s) => view(s.subjectId));
  const rows = artworkRows(manifest, items);

  it('one row per manifest subject, counted by effective status', () => {
    expect(rows).toHaveLength(manifest.subjects.length);
    const c = statusCounts(rows);
    expect(c.verified + c.approximate + c.unresolved).toBe(manifest.subjects.length);
    expect(c.verified).toBe(0);
  });

  it('filters by status, by "your decisions" and by search text on exact labels and ids', () => {
    expect(filterRows(rows, 'approximate', '').every((r) => r.view?.effective.status === 'approximate')).toBe(
      true,
    );
    expect(filterRows(rows, 'mine', '')).toHaveLength(0);
    expect(filterRows(rows, 'all', 'agriculture').map((r) => r.subject.subjectId)).toContain('art:num-25');
    expect(filterRows(rows, 'all', 'art:num-34').map((r) => r.subject.subjectId)).toEqual(['art:num-34']);
  });
});

describe('decision form', () => {
  it('verified needs evidence and a known campus building', () => {
    expect(validateAssociationForm(form(), { today: TODAY, buildingKnown: known })).toEqual({});
    expect(
      validateAssociationForm(form({ evidence: [] }), { today: TODAY, buildingKnown: known }),
    ).toHaveProperty('evidence');
    expect(
      validateAssociationForm(form({ buildingId: 'osm:way/1' }), { today: TODAY, buildingKnown: known }),
    ).toHaveProperty('buildingId');
    expect(
      validateAssociationForm(form({ buildingId: '' }), { today: TODAY, buildingKnown: known }),
    ).toHaveProperty('buildingId');
  });

  it('official document needs a URL; dates are real and not in the future; descriptions are not empty', () => {
    const e = (over: object) => form({ evidence: [{ ...form().evidence[0]!, ...over }] });
    const check = (f: AssociationFormValues) =>
      validateAssociationForm(f, { today: TODAY, buildingKnown: known });
    expect(check(e({ kind: 'official-document' }))).toHaveProperty(['evidence.0.url']);
    expect(check(e({ kind: 'official-document', url: 'https://lpu.example/doc.pdf' }))).toEqual({});
    expect(check(e({ url: 'javascript:alert(1)' }))).toHaveProperty(['evidence.0.url']);
    expect(check(e({ date: '2026-10-25' }))).toHaveProperty(['evidence.0.date']);
    expect(check(e({ date: '2026-02-30' }))).toHaveProperty(['evidence.0.date']);
    expect(check(e({ description: ' ' }))).toHaveProperty(['evidence.0.description']);
  });

  it('Google Maps / Earth / Street View are never a source: refused as the URL or inside the description', () => {
    const e = (over: object) => form({ evidence: [{ ...form().evidence[0]!, ...over }] });
    const check = (f: AssociationFormValues) =>
      validateAssociationForm(f, { today: TODAY, buildingKnown: known });
    for (const url of [
      'https://www.google.com/maps/place/LPU',
      'https://maps.app.goo.gl/abc',
      'https://maps.google.co.in/?q=lpu',
    ]) {
      expect(check(e({ kind: 'official-document', url }))['evidence.0.url'], url).toBe(
        PROHIBITED_SOURCE_MESSAGE,
      );
    }
    expect(check(e({ description: 'Pinned at maps.app.goo.gl/xyz' }))['evidence.0.description']).toBe(
      PROHIBITED_SOURCE_MESSAGE,
    );
    expect(check(e({ kind: 'official-document', url: 'https://www.lpu.in/directory.pdf' }))).toEqual({});
  });

  it('approximate needs a private note; unresolved carries no evidence', () => {
    const check = (f: AssociationFormValues) =>
      validateAssociationForm(f, { today: TODAY, buildingKnown: known });
    expect(check(form({ status: 'approximate', evidence: [] }))).toHaveProperty('note');
    expect(check(form({ status: 'approximate', evidence: [], note: 'Looks like it' }))).toEqual({});
    expect(check(form({ status: 'unresolved', buildingId: '' }))).toHaveProperty('evidence');
    expect(check(form({ status: 'unresolved', buildingId: '', evidence: [] }))).toEqual({});
  });

  it('builds the strict PUT body: trimmed, url only when given, unresolved without building or evidence', () => {
    expect(
      associationWriteBody(
        form({
          evidence: [{ kind: 'site-sign', description: '  Sign  ', url: ' ', date: '2026-10-20' }],
          note: ' ',
        }),
        null,
      ),
    ).toEqual({
      expectedRevision: null,
      status: 'verified',
      buildingId: 'osm:way/422437890',
      evidence: [{ kind: 'site-sign', description: 'Sign', date: '2026-10-20' }],
      note: null,
    });
    expect(associationWriteBody(form({ status: 'unresolved', note: 'No' }), 4)).toEqual({
      expectedRevision: 4,
      status: 'unresolved',
      buildingId: null,
      evidence: [],
      note: 'No',
    });
  });

  it('starts from the owner decision, else from the curated status and building', () => {
    expect(formFrom(view('art:num-25'))).toEqual({
      status: 'approximate',
      buildingId: baseline('art:num-25').buildingId,
      evidence: [],
      note: '',
    });
    const decided = view('art:num-34', {
      decision: {
        subjectId: 'art:num-34',
        status: 'verified',
        buildingId: 'osm:way/422437890',
        evidence: [{ kind: 'owner-statement', description: 'Checked', date: '2026-10-22' }],
        note: 'n',
        createdBy: 'owner',
        createdAt: '2026-10-24T00:00:00.000Z',
        updatedBy: 'owner',
        updatedAt: '2026-10-24T00:00:00.000Z',
        revision: 3,
      },
    });
    expect(formFrom(decided)).toEqual({
      status: 'verified',
      buildingId: 'osm:way/422437890',
      evidence: [{ kind: 'owner-statement', description: 'Checked', url: '', date: '2026-10-22' }],
      note: 'n',
    });
  });
});

describe('artwork images', () => {
  const space = { width: 3371, height: 2384 };
  it('the zoom window contains the outline, keeps a minimum size and never leaves the image', () => {
    const b = zoomViewBox({ x: 10, y: 20, width: 40, height: 30 }, space);
    expect(b).toEqual({ x: 0, y: 0, width: 360, height: 360 });
    const c = zoomViewBox({ x: 3300, y: 2300, width: 60, height: 70 }, space);
    expect(c.x + c.width).toBeLessThanOrEqual(space.width);
    expect(c.y + c.height).toBeLessThanOrEqual(space.height);
    expect(c.x).toBeLessThanOrEqual(3300);
    const big = zoomViewBox({ x: 0, y: 0, width: 3371, height: 2384 }, space);
    expect(big).toEqual({ x: 0, y: 0, ...space });
  });

  it('a byte-identical duplicate is displayed through its canonical copy', () => {
    expect(displayAsset(manifest, 'iso-art-115')?.assetId).toBe('iso-art-111');
    expect(displayAsset(manifest, 'iso-art-087')?.original?.url).toBe(
      'original/87-lpu-isometric-map-design-963.png',
    );
  });
});

describe('Studio read-only link and audit integration', () => {
  it('lists the subjects linked (verified or unconfirmed) to a studio record or the base building it models', () => {
    const items = [
      view('art:num-25'),
      view('art:num-34', {
        effective: {
          ...view('art:num-34').effective,
          status: 'verified',
          buildingId: 'stu:abc',
          source: 'owner',
        },
      }),
    ];
    expect(linksForBuildings(items, ['stu:abc']).map((i) => i.subjectId)).toEqual(['art:num-34']);
    expect(linksForBuildings(items, [baseline('art:num-25').buildingId!]).map((i) => i.subjectId)).toEqual([
      'art:num-25',
    ]);
    expect(linksForBuildings(items, ['osm:way/1'])).toEqual([]);
  });

  it("the admin reads 'artwork' audit rows and links them to the Artwork section", () => {
    const ev = auditEventSchema.parse({
      id: 1,
      at: '2026-10-24T09:00:00.000Z',
      actor: 'owner',
      action: 'artwork.put',
      entityType: 'artwork',
      entityId: 'art:num-34',
      before: null,
      after: { status: 'verified' },
      outcome: 'success',
      detail: null,
    });
    expect(entityRoute(ev)).toEqual({ section: 'artwork', id: 'art:num-34' });
    expect(ENTITY_LABELS.artwork).toBe('Artwork link');
    expect(actionLabel('artwork.reset')).toMatch(/curated baseline/);
    expect(ADMIN_SECTIONS).toContain('artwork');
    expect(ADMIN_SECTION_LABELS.artwork).toBe('Artwork');
  });
});
