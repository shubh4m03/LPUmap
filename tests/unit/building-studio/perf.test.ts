/**
 * Performance discipline (owner list E): mesh generation for 50 varied
 * instances, validation against the real dataset, and the studio merge with
 * 50 published buildings. Budgets are generous upper bounds for CI noise; the
 * measured medians are printed with a [studio-perf] prefix.
 */
import { describe, expect, it } from 'vitest';
import { deriveFootprint } from '../../../src/building-studio/footprint.ts';
import { createMeshCache } from '../../../src/building-studio/mesh/cache.ts';
import { generateStudioMeshDetailed } from '../../../src/building-studio/mesh/generate.ts';
import { mergeStudioBuildings } from '../../../src/building-studio/merge.ts';
import type { PublishedStudioBuilding } from '../../../src/building-studio/schema.ts';
import { validateStudioDraft } from '../../../src/building-studio/validate.ts';
import { median, medianTime } from '../perf-timing.ts';
import { draft, published } from './fixtures.ts';
import { variedModels } from './mesh-asserts.ts';
import { realContext, realData } from './real-data.ts';

const report = (label: string, ms: number, extra = '') =>
  process.stderr.write(`[studio-perf] ${label}: ${ms.toFixed(2)} ms${extra}\n`);

describe('studio performance', () => {
  const models = variedModels(50, 2026).map((m) => ({ ...m, detailLevel: 'details' as const }));

  it('generates 50 varied instances (details level) well within a frame budget', () => {
    let triangles = 0;
    const ms = medianTime(
      7,
      () => null,
      () => {
        triangles = 0;
        for (const m of models) {
          const r = generateStudioMeshDetailed(m);
          if (!r.ok) throw new Error(r.message);
          triangles += r.triangles;
        }
      },
    );
    report('generate 50 meshes', ms, `, ${triangles} triangles`);
    expect(ms).toBeLessThan(250);
  });

  it('a warm mesh cache returns all 50 in well under a millisecond each', () => {
    const cache = createMeshCache(64);
    for (const m of models) cache.get(m);
    const ms = medianTime(
      7,
      () => null,
      () => {
        for (const m of models) cache.get(m);
      },
    );
    report('cached 50 meshes', ms);
    expect(cache.misses).toBe(50);
    expect(ms).toBeLessThan(50);
  });

  it('validates a draft against the real dataset quickly', () => {
    const ctx = realContext();
    validateStudioDraft(draft(), ctx); // warm-up
    const times: number[] = [];
    for (const m of models.slice(0, 20)) {
      const t0 = performance.now();
      validateStudioDraft(draft({ model: m }), ctx);
      times.push(performance.now() - t0);
    }
    report('validate (median of 20 varied drafts)', median(times));
    expect(median(times)).toBeLessThan(100);
  });

  it('merges 50 published studio buildings into the real campus data', () => {
    const { campus } = realData();
    const records: PublishedStudioBuilding[] = models.map((m, i) => {
      const fp = deriveFootprint(m);
      if (!fp.ok) throw new Error(fp.message);
      return published({
        id: `stu:${'abcdefghijklmnopqrst'}${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`,
        model: m,
        footprint: fp.footprint,
        footprintAreaM2: fp.areaM2,
      });
    });
    const ms = medianTime(
      5,
      () => null,
      () => {
        mergeStudioBuildings({ data: campus, buildings: records });
      },
    );
    const r = mergeStudioBuildings({ data: campus, buildings: records });
    report(
      'merge 50 studio buildings',
      ms,
      `, ${r.report.added.length} added, ${r.report.outside.length} outside`,
    );
    expect(r.report.added.length + r.report.outside.length + r.report.heldForReview.length).toBe(50);
    expect(ms).toBeLessThan(500);
  });
});
