/**
 * GET /studio/quality — Building Studio data-quality warnings computed from
 * D1 against the CURRENT base dataset, so a base rebuild immediately surfaces
 * orphaned targets, published records that no longer validate and models this
 * build cannot generate. Read-only: nothing is repaired automatically.
 */
import { APP_CONFIG } from '../../../src/config/index.ts';
import { modelSupport, type StudioQualityResponse } from '../../../src/building-studio/schema.ts';
import { describeStudioOrphan } from '../../base-data.ts';
import {
  generatorVersionsInUse,
  getStudioVersionRow,
  listAllStudioBuildingRows,
} from '../../db/studio-buildings.ts';
import type { SqlDatabase } from '../../db/types.ts';
import type { StudioContext } from './context.ts';
import { classifyStored, publishedStudioBuildings, runValidation } from './engine.ts';
import { publicIdOf, readDraft, toPublishedStudioBuilding } from './records.ts';

const DAY_MS = 86_400_000;
type Json = Record<string, unknown>;
const modelOf = (v: unknown): unknown =>
  typeof v === 'object' && v !== null ? (v as Json).model : undefined;

export async function getStudioQuality(db: SqlDatabase, ctx: StudioContext): Promise<StudioQualityResponse> {
  const staleBefore = new Date(
    ctx.now.getTime() - APP_CONFIG.contributions.pendingStaleDays * DAY_MS,
  ).toISOString();
  const [heads, published, inUse] = await Promise.all([
    listAllStudioBuildingRows(db),
    publishedStudioBuildings(db),
    generatorVersionsInUse(db),
  ]);
  const warnings: StudioQualityResponse['warnings'] = [];
  const warn = (
    kind: StudioQualityResponse['warnings'][number]['kind'],
    h: { id: string; targetId: string | null },
    message: string,
  ) => warnings.push({ kind, id: h.id, targetId: h.targetId, message });

  for (const h of heads) {
    if (h.targetId !== null && !ctx.studio.buildingsById.has(h.targetId))
      warn(
        'orphan-target',
        h,
        `Record kept, not applied: ${describeStudioOrphan(ctx.studio, h.targetId)} Archive it, or model the replacement building.`,
      );
    if (h.draft !== null) {
      const support = modelSupport(modelOf(h.draft));
      if (!support.ok) warn('model-unavailable', h, `Draft model unavailable: ${support.message}`);
      if (h.draftSavedAt !== null && h.draftSavedAt < staleBefore)
        warn(
          'stale-draft',
          h,
          `Draft unchanged since ${h.draftSavedAt.slice(0, 10)} (more than ${APP_CONFIG.contributions.pendingStaleDays} days).`,
        );
    }
    if (h.status !== 'published' || h.publishedVersion === null) continue;
    const v = await getStudioVersionRow(db, h.id, h.publishedVersion);
    if (!v) continue;
    const support = modelSupport(modelOf(v.record));
    if (!support.ok)
      warn('model-unavailable', h, `Published model drawn as a plain footprint prism: ${support.message}`);
    const pub = toPublishedStudioBuilding(v, h.targetId);
    if (pub) {
      const m = classifyStored(pub.footprint, publicIdOf(h), ctx.studio);
      if (m.status === 'outside')
        warn(
          'outside-campus-now',
          h,
          `The current boundary classifies the published footprint as outside: ${m.reason}`,
        );
    }
    const record = readDraft(v.record);
    if (record) {
      const { result } = await runValidation(
        db,
        ctx,
        record,
        { recordId: h.id, targetId: h.targetId },
        published,
      );
      if (result.errorCount > 0)
        warn(
          'now-invalid',
          h,
          `Published version ${v.version} now fails validation: ${result.issues
            .filter((i) => i.severity === 'error')
            .map((i) => i.message)
            .join(' ')}`.slice(0, 1000),
        );
    }
  }
  return {
    warnings,
    generatorVersionsInUse: inUse.filter(
      (g) => Number.isInteger(g.generatorVersion) && g.generatorVersion >= 1,
    ),
  };
}
