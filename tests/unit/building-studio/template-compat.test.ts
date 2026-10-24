/**
 * Template/generator compatibility (S2, §3.3, §7 apply template, §12):
 * fallback prism for unknown models, template availability, and the
 * explicit, non-mutating "apply template vN" preview.
 */
import { describe, expect, it } from 'vitest';
import { starterTemplate } from '../../../src/building-studio/asset-library.ts';
import { localPolygonAreaM2 } from '../../../src/building-studio/footprint.ts';
import { createMeshCache } from '../../../src/building-studio/mesh/cache.ts';
import { meshVolumeM3 } from '../../../src/building-studio/mesh/generate.ts';
import { studioDraftSchema } from '../../../src/building-studio/schema.ts';
import {
  applyTemplateVersion,
  changedPaths,
  studioMeshFor,
  templateAvailability,
  templateRangeIssues,
} from '../../../src/building-studio/template-compat.ts';
import { clone, draft, model, published, template } from './fixtures.ts';

describe('studioMeshFor: never drop a record', () => {
  it('generates supported models (memoised through a cache when given)', () => {
    const cache = createMeshCache();
    const b = published();
    const a = studioMeshFor(b, { cache });
    expect(a).toMatchObject({ modelAvailable: true, unavailableReason: null });
    expect(studioMeshFor(b, { cache }).mesh).toBe(a.mesh);
    expect(cache.hits).toBe(1);
  });

  it('unknown modelConfigVersion / generator / version → fallback prism of footprint × body height', () => {
    for (const [over, reason] of [
      [{ modelConfigVersion: 2 }, 'unknown-model-config-version'],
      [{ generatorId: 'dome' }, 'unknown-generator'],
      [{ generatorVersion: 7 }, 'unknown-generator-version'],
      [{ shape: { kind: 'box', extra: 1 } }, 'invalid-config'],
    ] as const) {
      const b = published({ model: { ...model(), ...over } as never });
      const r = studioMeshFor(b);
      expect(r.modelAvailable, reason).toBe(false);
      expect(r.unavailableReason).toBe(reason);
      expect(r.message).toBeTruthy();
      expect(meshVolumeM3(r.mesh)).toBeCloseTo(localPolygonAreaM2(r.mesh.footprint) * 12.8, 3);
      expect(r.mesh.faces.some((f) => f.windows)).toBe(false);
    }
  });

  it('a generator failure also falls back (invalid-config)', () => {
    const b = published({
      model: model({
        generatorId: 'tower-podium',
        floors: 2,
        shape: { kind: 'tower-podium', podiumFloors: 3, towerWidthFrac: 0.5, towerLengthFrac: 0.5 },
      }),
    });
    expect(studioMeshFor(b)).toMatchObject({ modelAvailable: false, unavailableReason: 'invalid-config' });
  });
});

describe('templateAvailability', () => {
  const t1 = template();
  const listings = [{ definitions: [t1], status: 'active' as const }];
  const ref = { templateId: t1.id, templateVersion: 1, variantId: 'plain' };

  it('reports available, retired and every missing case without affecting the instance', () => {
    expect(templateAvailability(null, listings)).toEqual({ status: 'none', label: null });
    expect(templateAvailability(ref, listings)).toMatchObject({ status: 'available' });
    expect(templateAvailability(ref, [{ definitions: [t1], status: 'retired' }])).toMatchObject({
      status: 'retired',
    });
    expect(templateAvailability({ ...ref, templateId: 'gone' }, listings)).toEqual({
      status: 'missing-template',
      label: 'Template no longer available',
    });
    expect(templateAvailability({ ...ref, templateVersion: 3 }, listings)).toMatchObject({
      status: 'missing-version',
    });
    expect(templateAvailability({ ...ref, variantId: 'nope' }, listings)).toMatchObject({
      status: 'missing-variant',
    });
  });
});

describe('applyTemplateVersion: explicit preview, never mutating, never clamping', () => {
  it('replaces generator, shape, roof, facade and detail level; keeps placement, dimensions and identity', () => {
    const d = draft({ model: model({ widthM: 33, heightM: 13, rotationDeg: 77 }) });
    const before = clone(d);
    const lib = starterTemplate('library', 1)!.definition;
    const r = applyTemplateVersion(d, lib, 'courtyard');
    if (!r.ok) throw new Error(r.message);
    expect(d).toEqual(before); // input untouched
    expect(studioDraftSchema.parse(r.draft)).toEqual(r.draft);
    expect(r.draft.model).toMatchObject({
      generatorId: 'u-shape',
      shape: { kind: 'u-shape', openSide: 'none' },
      anchor: d.model.anchor,
      rotationDeg: 77,
      widthM: 33,
      heightM: 13,
      floors: d.model.floors,
    });
    expect(r.draft.identity).toEqual(d.identity);
    expect(r.draft.verification).toEqual(d.verification);
    expect(r.draft.templateRef).toEqual({
      templateId: 'library',
      templateVersion: 1,
      variantId: 'courtyard',
    });
    expect(r.changedFields).toEqual(
      expect.arrayContaining([
        'model.generatorId',
        'model.shape.kind',
        'model.roof.colour',
        'model.facade.material',
        'model.detailLevel',
        'templateRef.templateId',
      ]),
    );
    expect(r.changedFields).not.toContain('model.widthM');
    // 33 × 40 m, 13 m and 4 floors are all inside the library template's guidance.
    expect(r.rangeIssues).toEqual([]);
  });

  it('values outside the new template become outside-template-range warnings (nothing clamped)', () => {
    const d = draft({ model: model({ widthM: 8, floors: 1, heightM: 3.2 }) });
    const r = applyTemplateVersion(d, starterTemplate('library', 1)!.definition, 'open-u');
    if (!r.ok) throw new Error(r.message);
    expect(r.draft.model.widthM).toBe(8);
    expect(r.rangeIssues.map((i) => i.path).sort()).toEqual([
      'model.floors',
      'model.heightM',
      'model.widthM',
    ]);
    for (const i of r.rangeIssues)
      expect(i).toMatchObject({ code: 'outside-template-range', severity: 'warning' });
  });

  it('unknown variants and unsupported generator versions are refused', () => {
    expect(applyTemplateVersion(draft(), template(), 'nope')).toMatchObject({
      ok: false,
      reason: 'variant-not-found',
    });
    const future = template({
      generatorVersion: 2,
      variants: template().variants.map((v) => ({ ...v, defaults: { ...v.defaults, generatorVersion: 2 } })),
    });
    expect(applyTemplateVersion(draft(), future, 'plain')).toMatchObject({
      ok: false,
      reason: 'unsupported-model',
    });
  });

  it('templateRangeIssues covers roofs, window patterns and balconies', () => {
    const m = model({
      roof: { shape: 'gable', pitchDeg: 30, colour: '#884433', material: 'tile' },
      facade: { ...model().facade, windowPattern: 'grid', windowDensity: 0.5, balconies: true },
    });
    expect(templateRangeIssues(m, template()).map((i) => i.path)).toEqual([
      'model.roof.shape',
      'model.facade.windowPattern',
      'model.facade.balconies',
    ]);
  });

  it('changedPaths lists leaf differences', () => {
    expect(changedPaths({ a: 1, b: { c: 2, d: 3 } }, { a: 1, b: { c: 2, d: 4 }, e: 5 }, 'x')).toEqual([
      'x.b.d',
      'x.e',
    ]);
    expect(changedPaths(null, { a: 1 }, 'r')).toEqual(['r']);
  });
});
