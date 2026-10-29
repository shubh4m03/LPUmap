/**
 * The domain operations the HTTP layer calls. `server/handlers/repos.ts`
 * binds this port to the real implementation in server/domain; tests may
 * bind it to the same real implementation over a local D1 database.
 * Return values are passed through to the client as JSON (admin) — the
 * domain owns their shape.
 */
import type { BaseData, StudioBaseData } from '../base-data.ts';
import type { ArtworkDomainContext } from '../domain/artwork/associations.ts';
import type { StudioContext } from '../domain/studio/context.ts';
import type { IsometricArtManifest } from '../../src/isometric-art/index.ts';
import type { SqlDatabase } from '../db/types.ts';
import type { IdGenerator } from '../ids.ts';
import type { RateLimitRepo, SaltRepo, SessionRepo } from '../auth/ports.ts';
import type {
  ContributionInput,
  DuplicateCandidate,
  OverrideFields,
  PlaceFields,
  Publication,
} from '../../src/community/index.ts';

export interface DomainCtx {
  now: Date;
  actor?: string;
  base: BaseData;
  ids?: IdGenerator;
}

export interface AccessPointInput {
  nodeId: number;
  note?: string | undefined;
}

export type NullableFields<T> = { [K in keyof T]?: T[K] | null };

export type Filter = Record<string, string | number | undefined>;

export interface DomainPort {
  createSuggestion(
    db: SqlDatabase,
    input: ContributionInput,
    ctx: DomainCtx,
  ): Promise<{ reference: string; possibleDuplicates: DuplicateCandidate[] }>;
  /** Honeypot decoy: createSuggestion's checks, lookup and id format, but nothing is stored. */
  decoySuggestion(
    db: SqlDatabase,
    input: ContributionInput,
    ctx: DomainCtx,
  ): Promise<{ reference: string; possibleDuplicates: DuplicateCandidate[] }>;
  listSuggestions(db: SqlDatabase, filter: Filter): Promise<unknown>;
  getSuggestion(db: SqlDatabase, id: string, ctx: DomainCtx): Promise<unknown>;
  editSuggestion(
    db: SqlDatabase,
    id: string,
    /** A field set to null is cleared; absent fields are kept. */
    body: { revision: number; fields: NullableFields<Omit<ContributionInput, 'website'>> },
    ctx: DomainCtx,
  ): Promise<unknown>;
  approveSuggestion(
    db: SqlDatabase,
    id: string,
    /** Partial owner corrections; the domain validates the final merged record. */
    body: {
      revision: number;
      fields?: OverrideFields | undefined;
      accessPoint?: AccessPointInput | undefined;
    },
    ctx: DomainCtx,
  ): Promise<unknown>;
  rejectSuggestion(
    db: SqlDatabase,
    id: string,
    body: { revision: number; reason?: string | undefined },
    ctx: DomainCtx,
  ): Promise<unknown>;
  markDuplicate(
    db: SqlDatabase,
    id: string,
    body: { revision: number; duplicateOf: string },
    ctx: DomainCtx,
  ): Promise<unknown>;
  requestInformation(
    db: SqlDatabase,
    id: string,
    body: { revision: number; note?: string | undefined },
    ctx: DomainCtx,
  ): Promise<unknown>;
  reopenSuggestion(db: SqlDatabase, id: string, body: { revision: number }, ctx: DomainCtx): Promise<unknown>;

  listLocations(db: SqlDatabase, filter: Filter): Promise<unknown>;
  createLocation(
    db: SqlDatabase,
    body: { fields: PlaceFields; accessPoint?: AccessPointInput | undefined },
    ctx: DomainCtx,
  ): Promise<unknown>;
  updateLocation(
    db: SqlDatabase,
    id: string,
    /** PATCH: absent keys kept, null clears an optional field. */
    body: {
      revision: number;
      fields: NullableFields<PlaceFields>;
      accessPoint?: AccessPointInput | null | undefined;
    },
    ctx: DomainCtx,
  ): Promise<unknown>;
  hideLocation(db: SqlDatabase, id: string, body: { revision: number }, ctx: DomainCtx): Promise<unknown>;
  restoreLocation(db: SqlDatabase, id: string, body: { revision: number }, ctx: DomainCtx): Promise<unknown>;
  deleteLocation(
    db: SqlDatabase,
    id: string,
    body: { revision: number; confirmName: string },
    ctx: DomainCtx,
  ): Promise<unknown>;

  listOverrides(db: SqlDatabase, ctx: DomainCtx): Promise<unknown>;
  getOverride(db: SqlDatabase, targetId: string, ctx: DomainCtx): Promise<unknown>;
  putOverride(
    db: SqlDatabase,
    targetId: string,
    body: {
      revision: number | null;
      fields: OverrideFields;
      hidden: boolean;
      accessPoint?: AccessPointInput | null | undefined;
      note?: string | undefined;
    },
    ctx: DomainCtx,
  ): Promise<unknown>;
  hideOverride(
    db: SqlDatabase,
    targetId: string,
    body: { revision: number | null },
    ctx: DomainCtx,
  ): Promise<unknown>;
  unhideOverride(
    db: SqlDatabase,
    targetId: string,
    body: { revision: number },
    ctx: DomainCtx,
  ): Promise<unknown>;
  deleteOverride(
    db: SqlDatabase,
    targetId: string,
    body: { revision: number },
    ctx: DomainCtx,
  ): Promise<unknown>;

  revertAuditEvent(db: SqlDatabase, auditEventId: number, ctx: DomainCtx): Promise<unknown>;
  listAudit(db: SqlDatabase, filter: Filter): Promise<unknown>;

  getPublication(db: SqlDatabase): Promise<Publication>;
  /** The current publication version only (cheap; answers If-None-Match before the body is built). */
  getPublicationVersion(db: SqlDatabase): Promise<number>;
  getOverview(db: SqlDatabase, ctx: DomainCtx): Promise<unknown>;
  getQualityWarnings(db: SqlDatabase, ctx: DomainCtx): Promise<unknown>;
}

/**
 * Building Studio operations (docs/BUILDING_STUDIO_DESIGN.md §7). Bodies and
 * queries are passed RAW (already size- and structure-bounded): the domain
 * parses them inside its audit wrapper, so rejected writes are audited too.
 */
export interface StudioPort {
  getLibrary(db: SqlDatabase, ctx: StudioContext): Promise<unknown>;
  createTemplate(db: SqlDatabase, body: unknown, ctx: StudioContext): Promise<unknown>;
  updateTemplate(db: SqlDatabase, id: string, body: unknown, ctx: StudioContext): Promise<unknown>;
  retireTemplate(db: SqlDatabase, id: string, body: unknown, ctx: StudioContext): Promise<unknown>;
  unretireTemplate(db: SqlDatabase, id: string, body: unknown, ctx: StudioContext): Promise<unknown>;
  listBuildings(db: SqlDatabase, query: unknown, ctx: StudioContext): Promise<unknown>;
  getBuilding(db: SqlDatabase, id: string, ctx: StudioContext): Promise<unknown>;
  createBuilding(db: SqlDatabase, body: unknown, ctx: StudioContext): Promise<unknown>;
  saveDraft(db: SqlDatabase, id: string, body: unknown, ctx: StudioContext): Promise<unknown>;
  discardDraft(db: SqlDatabase, id: string, body: unknown, ctx: StudioContext): Promise<unknown>;
  validate(db: SqlDatabase, body: unknown, ctx: StudioContext): Promise<unknown>;
  publish(db: SqlDatabase, id: string, body: unknown, ctx: StudioContext): Promise<unknown>;
  archive(db: SqlDatabase, id: string, body: unknown, ctx: StudioContext): Promise<unknown>;
  restore(db: SqlDatabase, id: string, body: unknown, ctx: StudioContext): Promise<unknown>;
  deleteBuilding(db: SqlDatabase, id: string, body: unknown, ctx: StudioContext): Promise<unknown>;
  duplicate(db: SqlDatabase, id: string, body: unknown, ctx: StudioContext): Promise<unknown>;
  applyTemplate(db: SqlDatabase, id: string, body: unknown, ctx: StudioContext): Promise<unknown>;
  getQuality(db: SqlDatabase, ctx: StudioContext): Promise<unknown>;
}

/**
 * Owner verification of artwork associations
 * (docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md §4.2, server/domain/artwork).
 * Write bodies are passed RAW (size- and structure-bounded): the domain
 * parses them inside its audit wrapper, so rejected writes are audited too.
 */
export interface ArtworkPort {
  list(db: SqlDatabase, ctx: ArtworkDomainContext): Promise<unknown>;
  get(db: SqlDatabase, subjectId: string, ctx: ArtworkDomainContext): Promise<unknown>;
  put(db: SqlDatabase, subjectId: string, body: unknown, ctx: ArtworkDomainContext): Promise<unknown>;
  reset(db: SqlDatabase, subjectId: string, body: unknown, ctx: ArtworkDomainContext): Promise<unknown>;
}

export type FetchAsset = (path: string) => Promise<Response>;

export interface Services {
  domain: DomainPort;
  studio: StudioPort;
  artwork: ArtworkPort;
  sessions: SessionRepo;
  rateLimits: RateLimitRepo;
  salts: SaltRepo;
  loadBase: (fetchAsset: FetchAsset) => Promise<BaseData>;
  /** Studio view of the base dataset (buildings, graph, exact boundary, review sections), cached per version. */
  loadStudioBase: (fetchAsset: FetchAsset) => Promise<StudioBaseData>;
  /** The published artwork manifest (public/isometric-art/manifest.json), validated and cached. */
  loadArtManifest: (fetchAsset: FetchAsset) => Promise<IsometricArtManifest>;
}
