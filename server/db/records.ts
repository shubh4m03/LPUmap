/**
 * Admin-side record shapes and their mapping from D1 rows. Nullable columns
 * map to `null` (never `undefined`) so records round-trip through JSON and
 * audit snapshots unchanged.
 */
import type { LngLat, VerificationStatus, Wheelchair } from '../../src/data/index.ts';
import {
  overrideFieldsSchema,
  type OverrideFields,
  type PublishedLocation,
  type PublishedOverride,
  type SuggestionStatus,
} from '../../src/community/index.ts';

export interface SuggestionRecord {
  id: string;
  status: SuggestionStatus;
  name: string;
  categoryId: string;
  location: LngLat;
  description: string | null;
  landmark: string | null;
  evidenceUrl: string | null;
  details: string | null;
  duplicateOf: string | null;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  publishedLocationId: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export type LocationOrigin = 'owner' | 'community';
export type LocationStatus = 'active' | 'hidden';

export interface LocationRecord {
  id: string;
  origin: LocationOrigin;
  suggestionId: string | null;
  name: string;
  categoryId: string;
  location: LngLat;
  description: string | null;
  openingHours: string | null;
  wheelchair: Wheelchair;
  website: string | null;
  sourceUrl: string | null;
  verificationStatus: VerificationStatus;
  lastVerifiedAt: string | null;
  accessNodeId: number | null;
  accessNote: string | null;
  status: LocationStatus;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  revision: number;
}

export interface OverrideRecord {
  targetId: string;
  fields: OverrideFields;
  hidden: boolean;
  accessNodeId: number | null;
  accessNote: string | null;
  /** Private owner note — never published. */
  note: string | null;
  baseDatasetVersion: string;
  updatedBy: string;
  updatedAt: string;
  revision: number;
}

export type AuditOutcome = 'success' | 'rejected' | 'failed';
export type AuditEntityType =
  | 'suggestion'
  | 'location'
  | 'override'
  | 'session'
  | 'system'
  // Building Studio (migration 0002).
  | 'building'
  | 'template'
  // Artwork verification (migration 0003).
  | 'artwork';

export interface AuditEvent {
  id: number;
  at: string;
  actor: string;
  action: string;
  entityType: AuditEntityType;
  entityId: string | null;
  before: unknown;
  after: unknown;
  outcome: AuditOutcome;
  detail: string | null;
}

type Row = Record<string, unknown>;
const str = (r: Row, k: string): string => String(r[k]);
const optStr = (r: Row, k: string): string | null =>
  r[k] === null || r[k] === undefined ? null : String(r[k]);
const num = (r: Row, k: string): number => Number(r[k]);
const optNum = (r: Row, k: string): number | null =>
  r[k] === null || r[k] === undefined ? null : Number(r[k]);

export function rowToSuggestion(r: Row): SuggestionRecord {
  return {
    id: str(r, 'id'),
    status: str(r, 'status') as SuggestionStatus,
    name: str(r, 'name'),
    categoryId: str(r, 'category_id'),
    location: [num(r, 'lon'), num(r, 'lat')],
    description: optStr(r, 'description'),
    landmark: optStr(r, 'landmark'),
    evidenceUrl: optStr(r, 'evidence_url'),
    details: optStr(r, 'details'),
    duplicateOf: optStr(r, 'duplicate_of'),
    reviewNote: optStr(r, 'review_note'),
    reviewedBy: optStr(r, 'reviewed_by'),
    reviewedAt: optStr(r, 'reviewed_at'),
    publishedLocationId: optStr(r, 'published_location_id'),
    createdAt: str(r, 'created_at'),
    updatedAt: str(r, 'updated_at'),
    revision: num(r, 'revision'),
  };
}

export function rowToLocation(r: Row): LocationRecord {
  return {
    id: str(r, 'id'),
    origin: str(r, 'origin') as LocationOrigin,
    suggestionId: optStr(r, 'suggestion_id'),
    name: str(r, 'name'),
    categoryId: str(r, 'category_id'),
    location: [num(r, 'lon'), num(r, 'lat')],
    description: optStr(r, 'description'),
    openingHours: optStr(r, 'opening_hours'),
    wheelchair: str(r, 'wheelchair') as Wheelchair,
    website: optStr(r, 'website'),
    sourceUrl: optStr(r, 'source_url'),
    verificationStatus: str(r, 'verification_status') as VerificationStatus,
    lastVerifiedAt: optStr(r, 'last_verified_at'),
    accessNodeId: optNum(r, 'access_node_id'),
    accessNote: optStr(r, 'access_note'),
    status: str(r, 'status') as LocationStatus,
    createdBy: str(r, 'created_by'),
    createdAt: str(r, 'created_at'),
    updatedBy: str(r, 'updated_by'),
    updatedAt: str(r, 'updated_at'),
    revision: num(r, 'revision'),
  };
}

/** Stored override fields are re-validated on read; a corrupt row yields `{}` rather than unvalidated data. */
export function parseOverrideFields(json: unknown): OverrideFields {
  try {
    const r = overrideFieldsSchema.safeParse(JSON.parse(String(json)));
    return r.success ? r.data : {};
  } catch {
    return {};
  }
}

export function rowToOverride(r: Row): OverrideRecord {
  return {
    targetId: str(r, 'target_id'),
    fields: parseOverrideFields(r.fields_json),
    hidden: num(r, 'hidden') === 1,
    accessNodeId: optNum(r, 'access_node_id'),
    accessNote: optStr(r, 'access_note'),
    note: optStr(r, 'note'),
    baseDatasetVersion: str(r, 'base_dataset_version'),
    updatedBy: str(r, 'updated_by'),
    updatedAt: str(r, 'updated_at'),
    revision: num(r, 'revision'),
  };
}

const parseJson = (v: unknown): unknown => {
  if (v === null || v === undefined) return null;
  try {
    return JSON.parse(String(v));
  } catch {
    return null;
  }
};

export function rowToAudit(r: Row): AuditEvent {
  return {
    id: num(r, 'id'),
    at: str(r, 'at'),
    actor: str(r, 'actor'),
    action: str(r, 'action'),
    entityType: str(r, 'entity_type') as AuditEntityType,
    entityId: optStr(r, 'entity_id'),
    before: parseJson(r.before_json),
    after: parseJson(r.after_json),
    outcome: str(r, 'outcome') as AuditOutcome,
    detail: optStr(r, 'detail'),
  };
}

const opt = <T>(value: T | null): T | undefined => (value === null ? undefined : value);

/** Public shape: no actors, notes, suggestion link or status. */
export function toPublishedLocation(l: LocationRecord): PublishedLocation {
  const out: PublishedLocation = {
    id: l.id,
    origin: l.origin,
    name: l.name,
    categoryId: l.categoryId,
    location: l.location,
    wheelchair: l.wheelchair,
    verificationStatus: l.verificationStatus,
    accessNodeId: l.accessNodeId,
    revision: l.revision,
    updatedAt: l.updatedAt,
  };
  const optional = {
    description: opt(l.description),
    openingHours: opt(l.openingHours),
    website: opt(l.website),
    sourceUrl: opt(l.sourceUrl),
    lastVerifiedAt: opt(l.lastVerifiedAt),
  };
  for (const [k, val] of Object.entries(optional))
    if (val !== undefined) (out as Record<string, unknown>)[k] = val;
  return out;
}

export function toPublishedOverride(o: OverrideRecord): PublishedOverride {
  return {
    targetId: o.targetId,
    hidden: o.hidden,
    fields: o.fields,
    accessNodeId: o.accessNodeId,
    revision: o.revision,
    updatedAt: o.updatedAt,
  };
}
