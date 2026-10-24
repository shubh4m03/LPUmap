/** Pure Studio UI modules: wording, preview geometry, library items, snap targets, iso preview. */
import { describe, expect, it } from 'vitest';
import { starterLibrary } from '../../../src/building-studio/asset-library.ts';
import { createEnuFrame } from '../../../src/building-studio/geometry.ts';
import {
  VALIDATION_CODE_LIST,
  type TemplateListing,
  type ValidationIssue,
} from '../../../src/building-studio/schema.ts';
import { isoPreview } from '../../../src/building-studio/ui/iso-preview.ts';
import {
  builtInLibraryItems,
  libraryItems,
  variantDefaultsText,
  variantThumbnailUrl,
} from '../../../src/building-studio/ui/library.ts';
import {
  PREVIEW_RECORD_ID,
  previewCollection,
  previewFootprint,
  previewRenderSource,
} from '../../../src/building-studio/ui/preview.ts';
import { nearestBuildingOutline, nearestDetection } from '../../../src/building-studio/ui/snap-targets.ts';
import {
  changeList,
  fieldLabel,
  groupIssues,
  RESOLVE_HINTS,
  valueAt,
} from '../../../src/building-studio/ui/text.ts';
import { ANCHOR, draft, identity, model } from '../building-studio/fixtures.ts';
import { realData } from '../building-studio/real-data.ts';

const issue = (code: ValidationIssue['code'], severity: ValidationIssue['severity']): ValidationIssue => ({
  code,
  severity,
  message: code,
  path: null,
  data: {},
});

describe('wording', () => {
  it('every validation code has a resolution hint', () => {
    for (const c of VALIDATION_CODE_LIST) expect(RESOLVE_HINTS[c].length).toBeGreaterThan(10);
    expect(RESOLVE_HINTS['outside-campus']).toMatch(/cannot be acknowledged/);
  });

  it('groups issues by severity in validator order', () => {
    const g = groupIssues([
      issue('outside-campus', 'error'),
      issue('boundary-crossing', 'warning'),
      issue('nearby-path', 'info'),
      issue('possible-duplicate', 'warning'),
    ]);
    expect(g.error.map((i) => i.code)).toEqual(['outside-campus']);
    expect(g.warning.map((i) => i.code)).toEqual(['boundary-crossing', 'possible-duplicate']);
    expect(g.info).toHaveLength(1);
  });

  it('change list against the published version (or first publication)', () => {
    expect(changeList(null, draft())).toEqual(['First publication of this building.']);
    expect(changeList(draft(), draft())).toEqual(['No changes against the published version.']);
    const changed = draft({
      identity: identity({ name: 'North hostel' }),
      model: model({ heightM: 20, facade: { ...model().facade, wallColour: '#112233' } }),
    });
    expect(changeList(draft(), changed)).toEqual([
      'Name changed',
      'Façade wall colour changed',
      'Body height changed',
    ]);
  });

  it('field labels and values for before/after tables', () => {
    expect(fieldLabel('model.roof.colour')).toBe('Roof colour');
    expect(fieldLabel('model.facade.windowPattern')).toBe('Façade window pattern');
    expect(fieldLabel('model.anchor')).toBe('Position');
    expect(valueAt(draft(), 'model.roof.shape')).toBe('flat');
    expect(valueAt(draft(), 'identity.name')).toBe('—');
    expect(valueAt(draft(), 'model.anchor')).toBe('75.703200, 31.253300');
  });
});

describe('preview geometry', () => {
  it('footprint role, invalid role, snap proposal and guide outline', () => {
    const fc = previewCollection({
      model: model(),
      baseFootprint: null,
      invalid: false,
      proposal: model({ rotationDeg: 45 }),
      guide: { id: 'det:x', coordinates: [[ANCHOR, ANCHOR, ANCHOR, ANCHOR]] },
    });
    expect(fc.features.map((f) => f.properties.role)).toEqual(['guide', 'snap', 'footprint']);
    const bad = previewCollection({ model: model(), baseFootprint: null, invalid: true });
    expect(bad.features.at(-1)?.properties.role).toBe('footprint-invalid');
  });

  it('a model without a derivable footprint shows its anchor point and no 3D preview', () => {
    const broken = model({
      generatorId: 'stepped',
      shape: { kind: 'stepped', tiers: 5, setbackM: 20 },
      roof: { shape: 'stepped', colour: '#999999', material: 'concrete' },
      widthM: 10,
      lengthM: 10,
    });
    expect(previewFootprint(broken, null).ok).toBe(false);
    const fc = previewCollection({ model: broken, baseFootprint: null, invalid: false });
    expect(fc.features).toEqual([
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: ANCHOR },
        properties: { role: 'point', id: 'edited' },
      },
    ]);
    expect(previewRenderSource(broken, { publicId: 'x', recordId: null, baseFootprint: null })).toBeNull();
  });

  it('the 3D preview is marked as a preview and never memoised (version 0)', () => {
    const src = previewRenderSource(model(), { publicId: 'stu:x', recordId: null, baseFootprint: null });
    expect(src).toMatchObject({ publicId: 'stu:x', recordId: PREVIEW_RECORD_ID, version: 0, preview: true });
  });
});

describe('library items', () => {
  it('built-in items are the 17 starter templates, all generic prefab and active', () => {
    const items = builtInLibraryItems();
    expect(items).toHaveLength(17);
    expect(items.every((i) => i.definition.accuracyClass === 'generic-prefab' && i.status === 'active')).toBe(
      true,
    );
  });

  it('server listings: code templates resolve to the starter entry, owner templates are measured', () => {
    const code = starterLibrary()[0]!;
    const owner: TemplateListing = {
      source: 'owner',
      status: 'retired',
      definition: {
        ...code.definition,
        id: 'stv:abcdefghijklmnopqrstuvwx',
        version: 2,
        accuracyClass: 'stylized',
      },
      versions: [1, 2],
      revision: 3,
    };
    const items = libraryItems([
      { source: 'code', status: 'active', definition: code.definition, versions: [1], revision: null },
      owner,
    ]);
    expect(items[0]!.variantStats).toBe(code.variantStats);
    expect(items[1]).toMatchObject({ source: 'owner', status: 'retired', versions: [1, 2], revision: 3 });
    expect(items[1]!.estimatedTriangles).toBeGreaterThan(0);
  });

  it('thumbnails are deterministic data: SVG URLs; defaults text is in metres', () => {
    const item = builtInLibraryItems()[0]!;
    const a = variantThumbnailUrl(item);
    expect(a).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
    expect(variantThumbnailUrl(item)).toBe(a);
    expect(variantThumbnailUrl(item, undefined, 1)).not.toBe(a);
    expect(variantThumbnailUrl(item, 'no-such-variant')).toBeNull();
    expect(variantDefaultsText(item.definition.variants[0]!)).toMatch(
      /^\d+(\.\d+)? × \d+(\.\d+)? m · \d+ floors? · /,
    );
  });
});

describe('snap targets on the real campus data', () => {
  const { campus } = realData();

  it('nearest mapped building outline, excluding the one being edited', () => {
    const f = campus.buildings.features.find((x) => x.geometry.type === 'Polygon')!;
    const ring = (f.geometry.coordinates as [number, number][][])[0]!;
    const near = { anchor: ring[0]! };
    const t = nearestBuildingOutline(campus.buildings, near);
    expect(t?.id).toBe(f.properties.id);
    expect(t?.distanceM).toBe(0);
    const other = nearestBuildingOutline(campus.buildings, near, { excludeId: f.properties.id });
    expect(other?.id).not.toBe(f.properties.id);
    expect(nearestBuildingOutline(campus.buildings, { anchor: [0, 0] })).toBeNull();
  });

  it('detections: polygons only, never point detections', () => {
    const f = createEnuFrame(ANCHOR);
    const square = [
      [
        f.toLngLat([-5, -5]),
        f.toLngLat([5, -5]),
        f.toLngLat([5, 5]),
        f.toLngLat([-5, 5]),
        f.toLngLat([-5, -5]),
      ],
    ];
    const props = (id: string, geometryKind: 'footprint' | 'point') =>
      ({ id, source: 'microsoft-ml', geometryKind }) as never;
    const det = {
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: ANCHOR },
          properties: props('det:microsoft-ml:00000001', 'point'),
        },
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: square },
          properties: props('det:microsoft-ml:00000002', 'footprint'),
        },
      ],
    } as never;
    expect(nearestDetection(det, { anchor: ANCHOR })?.id).toBe('det:microsoft-ml:00000002');
  });
});

describe('isometric check (same merge as the public app)', () => {
  const { campus, base } = realData();
  const opts = { reviewSections: base.reviewSections, curatedDecisions: base.curatedDecisions };

  it('an on-campus draft becomes exactly one feature and one model with the public id', () => {
    const d = draft({ model: model({ rotationDeg: 0 }) });
    const fp = previewFootprint(d.model, null);
    if (!fp.ok) throw new Error('fp');
    const r = isoPreview({
      data: campus,
      draft: d,
      recordId: null,
      targetId: null,
      footprint: fp.footprint,
      areaM2: fp.areaM2,
      ...opts,
    });
    if (!r.ok) throw new Error(r.message);
    expect(r.publicId).toBe(PREVIEW_RECORD_ID);
    expect(r.models).toHaveLength(1);
    expect(r.data.buildings.features.filter((x) => x.properties.id === PREVIEW_RECORD_ID)).toHaveLength(1);
  });

  it('an off-campus draft is reported, never drawn', () => {
    const [w, s] = [campus.manifest.bbox[0], campus.manifest.bbox[1]];
    const far = draft({ model: model({ anchor: [w + 0.0001, s + 0.0001] }) });
    const fp = previewFootprint(far.model, null);
    if (!fp.ok) throw new Error('fp');
    const r = isoPreview({
      data: campus,
      draft: far,
      recordId: null,
      targetId: null,
      footprint: fp.footprint,
      areaM2: fp.areaM2,
      ...opts,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/outside the campus|uncertain/);
  });
});
