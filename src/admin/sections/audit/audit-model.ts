/**
 * Audit history model (pure): field-level changes between an event's
 * snapshots, which events can be reverted (mirrors the server's
 * REVERTABLE_ACTIONS in server/domain/revert.ts; the server decides), links
 * to the affected record, and the URL filters.
 */
import type { AuditEntityType, AuditEvent } from '../../api/schemas.ts';
import type { AdminRouteTarget } from '../../router.ts';

/** server/domain/revert.ts REVERTABLE_ACTIONS (a unit test keeps the two equal). */
export const REVERTABLE_ACTIONS: ReadonlySet<string> = new Set([
  'location.update',
  'location.hide',
  'location.restore',
  'location.delete',
  'location.revert',
  'override.put',
  'override.hide',
  'override.unhide',
  'override.delete',
  'override.revert',
]);

export const canRevert = (e: AuditEvent): boolean =>
  e.outcome === 'success' && REVERTABLE_ACTIONS.has(e.action);

export const ENTITY_LABELS: Readonly<Record<AuditEntityType, string>> = {
  suggestion: 'Suggestion',
  location: 'Location',
  override: 'Override',
  session: 'Session',
  system: 'System',
  building: 'Studio building',
  template: 'Studio template',
  artwork: 'Artwork link',
};

/** Human wording for known actions; unknown actions are shown as recorded. */
export const ACTION_LABELS: Readonly<Record<string, string>> = {
  'suggestion.create': 'Suggestion submitted',
  'suggestion.edit': 'Suggestion edited',
  'suggestion.approve': 'Suggestion approved',
  'suggestion.reject': 'Suggestion rejected',
  'suggestion.duplicate': 'Marked as duplicate',
  'suggestion.request-info': 'Marked as needing information',
  'suggestion.reopen': 'Suggestion reopened',
  'location.create': 'Location created',
  'location.update': 'Location edited',
  'location.hide': 'Location hidden',
  'location.restore': 'Location restored',
  'location.delete': 'Location deleted',
  'location.revert': 'Location reverted',
  'override.put': 'Override saved',
  'override.hide': 'Base place hidden',
  'override.unhide': 'Base place shown again',
  'override.delete': 'Override removed (back to base values)',
  'override.revert': 'Override reverted',
  'audit.revert': 'Change reverted',
  'artwork.put': 'Artwork link decided',
  'artwork.reset': 'Artwork link reset to the curated baseline',
};

export const actionLabel = (action: string): string => ACTION_LABELS[action] ?? action;

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

/** Bookkeeping fields that change on every write and say nothing to the owner. */
const NOISE = new Set(['revision', 'updatedAt', 'updatedBy']);

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Top-level fields that differ between the snapshots (nested `fields`
 * objects of overrides are expanded as `fields.name`). A created record lists
 * its values with `before` undefined; a deleted one its values with `after`
 * undefined.
 */
export function fieldChanges(before: unknown, after: unknown): FieldChange[] {
  const b = isObj(before) ? before : {};
  const a = isObj(after) ? after : {};
  const out: FieldChange[] = [];
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
  for (const k of keys) {
    if (NOISE.has(k)) continue;
    if (isObj(b[k]) || isObj(a[k])) {
      for (const c of fieldChanges(b[k], a[k])) out.push({ ...c, field: `${k}.${c.field}` });
      continue;
    }
    if (!same(b[k], a[k])) out.push({ field: k, before: b[k], after: a[k] });
  }
  return out;
}

/** Short display of a snapshot value. */
export function displayValue(v: unknown): string {
  if (v === undefined) return '—';
  if (v === null) return 'empty';
  if (typeof v === 'string') return v === '' ? 'empty' : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number'))
    return `${(v[1] as number).toFixed(6)}, ${(v[0] as number).toFixed(6)}`;
  return JSON.stringify(v);
}

/** Where the affected record is shown in the admin, if anywhere. */
export function entityRoute(e: Pick<AuditEvent, 'entityType' | 'entityId'>): AdminRouteTarget | null {
  if (!e.entityId) return null;
  switch (e.entityType) {
    case 'suggestion':
      return { section: 'queue', id: e.entityId };
    case 'location':
      return { section: 'locations', id: e.entityId };
    case 'override':
      return { section: 'overrides', id: e.entityId };
    case 'building':
      return { section: 'studio', id: e.entityId };
    case 'template':
      return { section: 'templates', id: e.entityId };
    case 'artwork':
      return { section: 'artwork', id: e.entityId };
    default:
      return null;
  }
}

export interface AuditFilters {
  entity: AuditEntityType | null;
  entityId: string;
  action: string;
}

const ENTITY_TYPES = Object.keys(ENTITY_LABELS) as AuditEntityType[];

export function parseAuditFilters(query: Readonly<Record<string, string>>): AuditFilters {
  const entity = ENTITY_TYPES.find((t) => t === query.entity) ?? null;
  return {
    entity,
    entityId: (query.entityId ?? '').trim().slice(0, 200),
    action: (query.action ?? '').trim().slice(0, 64),
  };
}

export function auditFiltersQuery(f: AuditFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.entity) out.entity = f.entity;
  if (f.entityId) out.entityId = f.entityId;
  if (f.action) out.action = f.action;
  return out;
}
