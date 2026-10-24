/**
 * Crash recovery of unsaved local edits (S8): never authoritative, every
 * storage access guarded, stale or invalid entries dropped.
 */
import { describe, expect, it } from 'vitest';
import {
  clearRecovery,
  LOCAL_RECOVERY_MAX_AGE_MS,
  loadRecovery,
  recoveryKey,
  saveRecovery,
  type RecoveryStorage,
} from '../../../src/building-studio/local-recovery.ts';
import { STU_ID, draft, identity } from './fixtures.ts';

function memory(): RecoveryStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const throwing: RecoveryStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

const NOW = new Date('2026-10-24T10:00:00.000Z');

describe('local recovery', () => {
  it('round-trips a draft under a per-record key', () => {
    const storage = memory();
    const d = draft({ identity: identity({ name: 'Draft hall' }) });
    expect(saveRecovery(recoveryKey(STU_ID, null), d, { storage, now: NOW, baseRevision: 3 })).toBe(true);
    expect(loadRecovery(STU_ID, { storage, now: NOW })).toEqual({
      key: STU_ID,
      savedAt: NOW.toISOString(),
      baseRevision: 3,
      draft: d,
    });
    expect(recoveryKey(null, 'osm:way/1')).toBe('new:osm:way/1');
    expect(recoveryKey(null, null)).toBe('new');
    clearRecovery(STU_ID, { storage });
    expect(loadRecovery(STU_ID, { storage, now: NOW })).toBeNull();
  });

  it('drops stale and invalid entries', () => {
    const storage = memory();
    saveRecovery('new', draft(), { storage, now: NOW });
    const later = new Date(NOW.getTime() + LOCAL_RECOVERY_MAX_AGE_MS + 1);
    expect(loadRecovery('new', { storage, now: later })).toBeNull();
    expect(storage.data.size).toBe(0);
    const key = 'lpu-atlas:studio-recovery:v1:new'; // APP_CONFIG.storage.prefix + the module's namespace
    storage.setItem(key, JSON.stringify({ savedAt: NOW.toISOString(), draft: { identity: 'nope' } }));
    expect(loadRecovery('new', { storage, now: NOW })).toBeNull();
    storage.setItem(key, '{not json');
    expect(loadRecovery('new', { storage, now: NOW })).toBeNull();
  });

  it('never throws when storage is blocked or unavailable', () => {
    expect(saveRecovery('new', draft(), { storage: throwing })).toBe(false);
    expect(loadRecovery('new', { storage: throwing })).toBeNull();
    expect(() => clearRecovery('new', { storage: throwing })).not.toThrow();
    expect(saveRecovery('new', draft(), { storage: null })).toBe(false);
    expect(loadRecovery('new', { storage: null })).toBeNull();
  });
});
