/**
 * Domain entry point for the HTTP layer. Every function takes the database
 * first and (where needed) a DomainContext `{ now, actor, base, ids? }`, and
 * throws DomainError for expected failures. Privileged operations require an
 * authenticated `ctx.actor`, are audited (success in the same batch as the
 * change; rejected/failed attempts afterwards) and bump publication_version
 * with every publicly visible change.
 */
export type { DomainContext } from './context.ts';
export { PUBLIC_ACTOR } from './context.ts';
export {
  createSuggestion,
  decoySuggestion,
  listSuggestions,
  getSuggestion,
  editSuggestion,
  duplicatesForSuggestion,
  EDITABLE_STATUSES,
} from './suggestions.ts';
export {
  approveSuggestion,
  rejectSuggestion,
  markDuplicate,
  requestInformation,
  reopenSuggestion,
  allowedFrom,
} from './moderation.ts';
export type { ApproveResult } from './moderation.ts';
export {
  listLocations,
  getLocation,
  createLocation,
  updateLocation,
  hideLocation,
  restoreLocation,
  deleteLocation,
} from './locations.ts';
export {
  listOverrides,
  getOverride,
  putOverride,
  hideOverride,
  unhideOverride,
  deleteOverride,
  normalizeOverrideFields,
} from './overrides.ts';
export type { OverrideView } from './overrides.ts';
export { revertAuditEvent, listAudit, REVERTABLE_ACTIONS } from './revert.ts';
export { getPublication, getPublicationVersion } from './publication.ts';
export { getOverview, getQualityWarnings } from './overview.ts';
export type { QualityWarning, QualityWarningKind } from './overview.ts';

// Session and rate-limit repositories (used by server/auth through server/handlers/repos.ts).
export {
  createSession,
  getSession,
  touchSession,
  deleteSession,
  purgeExpiredSessions,
} from '../db/sessions.ts';
export type { NewSession, SessionRecord } from '../db/sessions.ts';
export { hit, purgeExpiredRateLimits } from '../db/rate-limits.ts';
export type { RateLimitResult } from '../db/rate-limits.ts';
export type { AuditEvent, LocationRecord, OverrideRecord, SuggestionRecord } from '../db/records.ts';
