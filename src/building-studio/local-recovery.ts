/**
 * Crash recovery of UNSAVED local Studio edits (S8). Browser storage is used
 * only for this, is never authoritative, and every access is wrapped in
 * try/catch: in a private window, with blocked site data or a full quota the
 * functions simply report nothing stored. A recovered draft is re-validated
 * with the strict draft schema and shown with LOCAL_RECOVERY_LABEL; the
 * server copy always wins unless the owner explicitly restores the local one.
 */
import { APP_CONFIG } from '../config/index.ts';
import { studioDraftSchema, type StudioDraft } from './schema.ts';

export const LOCAL_RECOVERY_LABEL = 'Unsaved changes recovered from this browser — not saved on the server';
/** Entries older than this are discarded. */
export const LOCAL_RECOVERY_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
/** Larger payloads are not stored (a draft is ≤ 16 KB on the server). */
export const LOCAL_RECOVERY_MAX_BYTES = 64 * 1024;

const PREFIX = `${APP_CONFIG.storage.prefix}:studio-recovery:v1:`;

export interface RecoveryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface RecoveryEntry {
  key: string;
  savedAt: string;
  /** Server revision the edits started from (null for a building not yet on the server). */
  baseRevision: number | null;
  draft: StudioDraft;
}

function defaultStorage(): RecoveryStorage | null {
  try {
    return (globalThis as { localStorage?: RecoveryStorage }).localStorage ?? null;
  } catch {
    return null;
  }
}

/** Storage key part for a record (`stu:` id), a new model of a base building, or a new building. */
export const recoveryKey = (recordId: string | null, targetId: string | null): string =>
  recordId ?? (targetId ? `new:${targetId}` : 'new');

export interface RecoveryOptions {
  storage?: RecoveryStorage | null;
  now?: Date;
}

/** Stores the unsaved draft; false when storage is unavailable, full or the draft too large. */
export function saveRecovery(
  key: string,
  draft: StudioDraft,
  opts: RecoveryOptions & { baseRevision?: number | null } = {},
): boolean {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  if (!storage) return false;
  try {
    const value = JSON.stringify({
      savedAt: (opts.now ?? new Date()).toISOString(),
      baseRevision: opts.baseRevision ?? null,
      draft,
    });
    if (value.length > LOCAL_RECOVERY_MAX_BYTES) return false;
    storage.setItem(PREFIX + key, value);
    return true;
  } catch {
    return false;
  }
}

/** The stored draft when present, fresh and still a valid draft; otherwise null (stale or invalid entries are removed). */
export function loadRecovery(
  key: string,
  opts: RecoveryOptions & { maxAgeMs?: number } = {},
): RecoveryEntry | null {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  if (!storage) return null;
  try {
    const raw = storage.getItem(PREFIX + key);
    if (raw === null) return null;
    const v = JSON.parse(raw) as { savedAt?: unknown; baseRevision?: unknown; draft?: unknown };
    const savedAt = typeof v.savedAt === 'string' ? Date.parse(v.savedAt) : Number.NaN;
    const now = (opts.now ?? new Date()).getTime();
    const draft = studioDraftSchema.safeParse(v.draft);
    const baseRevision =
      typeof v.baseRevision === 'number' && Number.isInteger(v.baseRevision) ? v.baseRevision : null;
    if (
      !draft.success ||
      Number.isNaN(savedAt) ||
      now - savedAt > (opts.maxAgeMs ?? LOCAL_RECOVERY_MAX_AGE_MS)
    ) {
      storage.removeItem(PREFIX + key);
      return null;
    }
    return { key, savedAt: new Date(savedAt).toISOString(), baseRevision, draft: draft.data };
  } catch {
    return null;
  }
}

/** Storage that can also enumerate its keys (window.localStorage satisfies it). */
export interface EnumerableRecoveryStorage extends RecoveryStorage {
  readonly length: number;
  key(index: number): string | null;
}

/**
 * Removes EVERY stored Studio recovery entry of this browser (on admin
 * logout, so unsaved drafts never outlive the session that made them).
 * Returns how many entries were removed; 0 when storage is unavailable.
 */
export function clearAllRecovery(opts: { storage?: EnumerableRecoveryStorage | null } = {}): number {
  let storage: EnumerableRecoveryStorage | null;
  try {
    storage =
      opts.storage === undefined
        ? ((globalThis as { localStorage?: EnumerableRecoveryStorage }).localStorage ?? null)
        : opts.storage;
  } catch {
    return 0;
  }
  if (!storage) return 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k !== null && k.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) storage.removeItem(k);
    return keys.length;
  } catch {
    return 0;
  }
}

/** Removes the stored draft (after a successful save, a discard or an explicit dismissal). */
export function clearRecovery(key: string, opts: Pick<RecoveryOptions, 'storage'> = {}): void {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  try {
    storage?.removeItem(PREFIX + key);
  } catch {
    // Storage blocked: nothing to clear.
  }
}
