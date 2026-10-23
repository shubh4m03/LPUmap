/**
 * Admin dashboard figures and data-quality warnings, computed from the real
 * D1 state against the CURRENT base dataset (so a base rebuild immediately
 * surfaces orphaned overrides and access nodes that no longer validate).
 */
import { APP_CONFIG } from '../../src/config/index.ts';
import { describeOrphan, orphanReasonFor, type OrphanReason } from '../base-data.ts';
import { findPossibleDuplicates } from '../../src/community/duplicates.ts';
import { checkAccessNode, pointInPolygons } from '../../src/community/geo.ts';
import { countAuditSince } from '../db/audit.ts';
import { countLocations, listLocationRows } from '../db/locations.ts';
import { getPublicationState } from '../db/meta.ts';
import { listOverrideRows } from '../db/overrides.ts';
import { purgeExpiredRateLimits } from '../db/rate-limits.ts';
import { purgeExpiredSessions } from '../db/sessions.ts';
import { countSuggestionsByStatus, stalePendingSuggestions } from '../db/suggestions.ts';
import type { SqlDatabase } from '../db/types.ts';
import type { DomainContext } from './context.ts';
import { baseSources, locationSources } from './duplicate-sources.ts';

export type QualityWarningKind =
  | 'orphan-override'
  | 'override-access-invalid'
  | 'location-outside-boundary'
  | 'location-not-routable'
  | 'possible-duplicate'
  | 'stale-pending';

export interface QualityWarning {
  kind: QualityWarningKind;
  entityType: 'override' | 'location' | 'suggestion';
  id: string;
  message: string;
  relatedId?: string;
  /** 'orphan-override' only: why the target is not a campus place (v2). */
  orphanReason?: OrphanReason;
}

const DAY_MS = 86_400_000;

export async function getQualityWarnings(
  db: SqlDatabase,
  ctx: Pick<DomainContext, 'base' | 'now'>,
): Promise<{ warnings: QualityWarning[]; counts: Record<QualityWarningKind, number> }> {
  const { base } = ctx;
  const staleBefore = new Date(
    ctx.now.getTime() - APP_CONFIG.contributions.pendingStaleDays * DAY_MS,
  ).toISOString();
  const [overrides, active, stale] = await Promise.all([
    listOverrideRows(db),
    listLocationRows(db, { status: 'active' }),
    stalePendingSuggestions(db, staleBefore),
  ]);
  const warnings: QualityWarning[] = [];

  for (const o of overrides) {
    const place = base.places.get(o.targetId);
    if (!place) {
      warnings.push({
        kind: 'orphan-override',
        entityType: 'override',
        id: o.targetId,
        orphanReason: orphanReasonFor(base, o.targetId) ?? 'not-in-dataset',
        message:
          `Override target is not in the current dataset (${base.datasetVersion}); it was made on ${o.baseDatasetVersion} and is not applied. ${describeOrphan(base, o.targetId)}`.trim(),
      });
      continue;
    }
    if (o.accessNodeId !== null && !o.hidden) {
      const loc = o.fields.location ?? place.location;
      const check = loc
        ? checkAccessNode(base.graphNodes, base.footNodes, o.accessNodeId, loc)
        : { ok: false as const, message: 'The place has no map position.' };
      if (!check.ok) {
        warnings.push({
          kind: 'override-access-invalid',
          entityType: 'override',
          id: o.targetId,
          message: `Access point no longer valid, so the place is not routable: ${check.message}`,
        });
      }
    }
  }

  for (const l of active) {
    if (!pointInPolygons(l.location, base.boundary)) {
      warnings.push({
        kind: 'location-outside-boundary',
        entityType: 'location',
        id: l.id,
        message: `"${l.name}" lies outside the campus boundary (shown as off-campus nearby).`,
      });
    }
    if (l.accessNodeId === null) {
      warnings.push({
        kind: 'location-not-routable',
        entityType: 'location',
        id: l.id,
        message: `"${l.name}" has no access point, so it is shown on the map but cannot be routed to.`,
      });
    } else {
      const check = checkAccessNode(base.graphNodes, base.footNodes, l.accessNodeId, l.location);
      if (!check.ok) {
        warnings.push({
          kind: 'location-not-routable',
          entityType: 'location',
          id: l.id,
          message: `"${l.name}" is not routable: ${check.message}`,
        });
      }
    }
  }

  // Possible duplicates among published data: each active location vs base places and other active locations.
  const hidden = new Set(overrides.filter((o) => o.hidden).map((o) => o.targetId));
  const sources = [...baseSources(base).filter((s) => !hidden.has(s.id)), ...locationSources(active)];
  const reported = new Set<string>();
  for (const l of active) {
    for (const d of findPossibleDuplicates(l, sources, { excludeIds: new Set([l.id]) })) {
      const pair = [l.id, d.id].sort().join('|');
      if (reported.has(pair)) continue;
      reported.add(pair);
      warnings.push({
        kind: 'possible-duplicate',
        entityType: 'location',
        id: l.id,
        relatedId: d.id,
        message: `"${l.name}" may duplicate "${d.name}" (${d.reason}).`,
      });
    }
  }

  for (const s of stale) {
    warnings.push({
      kind: 'stale-pending',
      entityType: 'suggestion',
      id: s.id,
      message: `Pending since ${s.createdAt.slice(0, 10)} (older than ${APP_CONFIG.contributions.pendingStaleDays} days).`,
    });
  }

  const counts: Record<QualityWarningKind, number> = {
    'orphan-override': 0,
    'override-access-invalid': 0,
    'location-outside-boundary': 0,
    'location-not-routable': 0,
    'possible-duplicate': 0,
    'stale-pending': 0,
  };
  for (const w of warnings) counts[w.kind]++;
  return { warnings, counts };
}

/**
 * Deletes expired rate-limit buckets and sessions. Public submissions and
 * logins already purge on every hit; running it on the owner's dashboard too
 * keeps the ≤ 48 h retention promise when public traffic stops (rate-limit
 * windows are ≤ 24 h, so a bucket is at most 24 h past expiry before the next
 * contribution, login or dashboard visit removes it).
 */
export async function purgeExpiredOperationalRows(db: SqlDatabase, now: Date) {
  const [rateLimits, sessions] = [await purgeExpiredRateLimits(db, now), await purgeExpiredSessions(db, now)];
  return { rateLimits, sessions };
}

export async function getOverview(db: SqlDatabase, ctx: Pick<DomainContext, 'base' | 'now'>) {
  await purgeExpiredOperationalRows(db, ctx.now);
  const weekAgo = new Date(ctx.now.getTime() - 7 * DAY_MS).toISOString();
  const [suggestions, locations, overrides, auditLast7Days, quality, publication] = await Promise.all([
    countSuggestionsByStatus(db),
    countLocations(db),
    listOverrideRows(db),
    countAuditSince(db, weekAgo),
    getQualityWarnings(db, ctx),
    getPublicationState(db),
  ]);
  return {
    suggestions,
    locations,
    overrides: {
      total: overrides.length,
      hidden: overrides.filter((o) => o.hidden).length,
      withFields: overrides.filter((o) => Object.keys(o.fields).length > 0).length,
      withAccessPoint: overrides.filter((o) => o.accessNodeId !== null).length,
      orphan: overrides.filter((o) => !ctx.base.places.has(o.targetId)).length,
    },
    auditLast7Days,
    qualityWarnings: quality.warnings.length,
    publicationVersion: publication.version,
    datasetVersion: ctx.base.datasetVersion,
  };
}
