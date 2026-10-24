/**
 * Starter library (S2, S3, S14): 17 types, schema-valid immutable
 * definitions, honest metadata, computed render cost, ≥ 2 visually distinct
 * variants for the major types, search and categorized listing.
 */
import { describe, expect, it } from 'vitest';
import {
  LIBRARY_CATEGORY_LABELS,
  libraryByCategory,
  modelFromVariant,
  renderCostForFaces,
  searchLibrary,
  starterLibrary,
  starterTemplate,
  STARTER_TEMPLATE_VERSIONS,
  templateRefFor,
} from '../../../src/building-studio/asset-library.ts';
import { meshHash } from '../../../src/building-studio/mesh/cache.ts';
import { generateStudioMeshDetailed } from '../../../src/building-studio/mesh/generate.ts';
import {
  GENERATORS,
  LIBRARY_CATEGORIES,
  modelConfigV1Schema,
  STUDIO_CATEGORY_IDS,
  STUDIO_LIMITS,
  templateDefinitionSchema,
  templateRefSchema,
  type TemplateDefinition,
} from '../../../src/building-studio/schema.ts';
import { validateStudioDraft } from '../../../src/building-studio/validate.ts';
import { ANCHOR, draft } from './fixtures.ts';
import { realContext } from './real-data.ts';

const lib = starterLibrary();
const byId = (id: string) => lib.find((e) => e.definition.id === id)!;

describe('starter library contents', () => {
  it('has the 17 owner types, one template per library category, in LIBRARY_CATEGORIES order', () => {
    expect(lib).toHaveLength(17);
    expect(lib.map((e) => e.definition.libraryCategory)).toEqual([...LIBRARY_CATEGORIES]);
    expect(new Set(lib.map((e) => e.definition.id)).size).toBe(17);
  });

  it('every definition parses with the strict contract schema and is generic-prefab v1', () => {
    for (const e of lib) {
      expect(templateDefinitionSchema.parse(e.definition)).toEqual(e.definition);
      expect(e.definition.accuracyClass).toBe('generic-prefab');
      expect(e.definition.version).toBe(1);
    }
  });

  it('uses every code generator except the internal footprint-prism; roofs are buildable by it', () => {
    const used = new Set(lib.map((e) => e.definition.generatorId));
    expect([...used].sort()).toEqual([
      'box',
      'hall',
      'kiosk-canopy',
      'l-shape',
      'stepped',
      'tower-podium',
      'u-shape',
    ]);
    for (const e of lib)
      for (const r of e.definition.constraints.roofShapes)
        expect(GENERATORS[e.definition.generatorId].roofs).toContain(r);
  });

  it('category hints come from the registry; the first is the suggested category', () => {
    for (const e of lib) {
      expect(e.categoryHints[0]).toBe(e.definition.suggestedCategoryId);
      for (const h of e.categoryHints) expect(STUDIO_CATEGORY_IDS).toContain(h);
      expect(e.categoryLabel).toBe(LIBRARY_CATEGORY_LABELS[e.definition.libraryCategory]);
    }
  });

  it('names and uses describe types only (no block numbers or claims about real buildings)', () => {
    for (const e of lib) {
      const t = [
        e.definition.name,
        e.definition.intendedUse,
        ...e.definition.variants.map((v) => `${v.name} ${v.description ?? ''}`),
      ].join(' ');
      expect(t).not.toMatch(/\b(block|bk)\s*[-#]?\s*\d+/i);
      expect(t).not.toMatch(/\bLPU\b|Lovely/i);
      expect(e.definition.intendedUse).toMatch(/illustrative/);
    }
  });

  it('variant defaults stay inside publish ranges and raise no height/floors conflict', () => {
    for (const e of lib)
      for (const v of e.definition.variants) {
        const d = v.defaults;
        for (const k of ['widthM', 'lengthM', 'heightM', 'floors', 'floorHeightM'] as const) {
          expect(d[k], `${e.definition.id}/${v.id} ${k}`).toBeGreaterThanOrEqual(STUDIO_LIMITS.dims[k].min);
          expect(d[k], `${e.definition.id}/${v.id} ${k}`).toBeLessThanOrEqual(STUDIO_LIMITS.dims[k].max);
        }
        expect(d.heightM).toBeCloseTo(d.floors * d.floorHeightM, 6);
      }
  });

  it('major types have ≥ 2 visually distinct variants (different meshes and appearance)', () => {
    for (const id of [
      'academic-block',
      'hostel-multistorey',
      'residential',
      'canteen-kiosk',
      'administrative',
      'sports-facility',
    ]) {
      const e = byId(id);
      expect(e.definition.variants.length, id).toBeGreaterThanOrEqual(2);
      const hashes = e.definition.variants.map((v) => {
        const r = generateStudioMeshDetailed(modelFromVariant(v, { anchor: ANCHOR, rotationDeg: 0 }));
        if (!r.ok) throw new Error(r.message);
        return meshHash(r.mesh);
      });
      expect(new Set(hashes).size, id).toBe(hashes.length);
      const looks = e.definition.variants.map(
        (v) => `${v.defaults.roof.shape}/${v.defaults.facade.windowPattern}/${v.defaults.facade.wallColour}`,
      );
      expect(new Set(looks).size, id).toBe(looks.length);
    }
  });

  it('render cost and triangle estimates are computed from the meshes', () => {
    for (const e of lib) {
      const stats = e.definition.variants.map((v) => {
        const r = generateStudioMeshDetailed(modelFromVariant(v, { anchor: ANCHOR, rotationDeg: 0 }));
        if (!r.ok) throw new Error(r.message);
        return { variantId: v.id, faces: r.mesh.faces.length, triangles: r.triangles };
      });
      expect(e.variantStats).toEqual(stats);
      expect(e.estimatedTriangles).toBe(Math.max(...stats.map((s) => s.triangles)));
      expect(e.definition.renderCost).toBe(renderCostForFaces(Math.max(...stats.map((s) => s.faces))));
    }
    expect([
      renderCostForFaces(59),
      renderCostForFaces(60),
      renderCostForFaces(249),
      renderCostForFaces(250),
    ]).toEqual(['low', 'medium', 'medium', 'high']);
  });

  it('a placed variant is a full, valid instance model that validates cleanly on campus', () => {
    const e = byId('academic-block');
    const v = e.definition.variants[0]!;
    const model = modelFromVariant(v, { anchor: ANCHOR, rotationDeg: 12 });
    expect(modelConfigV1Schema.parse(model)).toEqual(model);
    expect(templateRefSchema.parse(templateRefFor(e.definition, v.id))).toEqual({
      templateId: 'academic-block',
      templateVersion: 1,
      variantId: v.id,
    });
    // The instance is a copy: changing it never changes the template (S2).
    model.widthM = 99;
    expect(v.defaults.widthM).toBe(20);
    const result = validateStudioDraft(
      draft({
        model: modelFromVariant(v, { anchor: ANCHOR, rotationDeg: 12 }),
        templateRef: templateRefFor(e.definition, v.id),
      }),
      realContext({ template: e.definition }),
    );
    expect(result.issues.filter((i) => i.code === 'outside-template-range')).toEqual([]);
  });
});

describe('versions, lookup, browsing and search', () => {
  it('resolves exact versions; unknown ids and versions are null', () => {
    expect(STARTER_TEMPLATE_VERSIONS).toHaveLength(17);
    expect(starterTemplate('library', 1)?.definition.id).toBe('library');
    expect(starterTemplate('library')?.definition.version).toBe(1);
    expect(starterTemplate('library', 2)).toBeNull();
    expect(starterTemplate('no-such-template')).toBeNull();
  });

  it('lists all 17 categories in order with labels', () => {
    const groups = libraryByCategory();
    expect(groups.map((g) => g.category)).toEqual([...LIBRARY_CATEGORIES]);
    expect(groups.every((g) => g.entries.length === 1 && g.label.length > 0)).toBe(true);
    expect(libraryByCategory([]).every((g) => g.entries.length === 0)).toBe(true);
  });

  it('searches names, uses, library categories and registry categories', () => {
    const ids = (q: string) => searchLibrary(q).map((e) => e.definition.id);
    expect(ids('')).toHaveLength(17);
    expect(ids('hostel')[0]).toBe('hostel-multistorey');
    expect(ids('canteen')).toContain('canteen-kiosk');
    expect(ids('food')).toContain('canteen-kiosk'); // registry category label
    expect(ids('gym')).toEqual(['sports-facility']); // intended use
    expect(ids('parking deck')).toEqual(['parking-structure']);
    expect(ids('LIBRARY')[0]).toBe('library');
    expect(ids('no such thing')).toEqual([]);
  });

  it('definitions are immutable values: the memoised library returns the same objects', () => {
    const again: readonly { definition: TemplateDefinition }[] = starterLibrary();
    expect(again).toBe(lib);
  });
});
