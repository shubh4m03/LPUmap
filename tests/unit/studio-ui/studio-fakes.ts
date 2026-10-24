/** A scriptable StudioApi (no network) and record builders for the Studio UI tests. */
import { vi } from 'vitest';
import { errorFromResponse, networkError, type AdminApiError } from '../../../src/admin/api/errors.ts';
import type { AdminResult } from '../../../src/admin/api/http.ts';
import type { StudioApi } from '../../../src/admin/api/studio.ts';
import type {
  StudioBuildingDetail,
  StudioBuildingHead,
  StudioDraft,
  ValidationResult,
} from '../../../src/building-studio/schema.ts';
import type { RecoveryStorage } from '../../../src/building-studio/local-recovery.ts';
import { draft, STU_ID, T } from '../building-studio/fixtures.ts';

export const ok = <T>(data: T, status = 200): AdminResult<T> => ({ ok: true, status, data });
export const fail = (e: AdminApiError): AdminResult<never> => ({ ok: false, error: e });
export const problem = (status: number, code: string, message: string, details?: unknown) =>
  fail(errorFromResponse(status, { error: { code, message, ...(details ? { details } : {}) } }));
export const offline = () => fail(networkError(true));

export function head(over: Partial<StudioBuildingHead> = {}): StudioBuildingHead {
  return {
    id: STU_ID,
    targetId: null,
    status: 'draft',
    revision: 1,
    draftRevision: 1,
    hasDraft: true,
    publishedVersion: null,
    archivedAt: null,
    archiveReason: null,
    createdBy: 'owner',
    createdAt: T,
    updatedBy: 'owner',
    updatedAt: T,
    ...over,
  };
}

export const EMPTY_VALIDATION: ValidationResult = {
  issues: [],
  errorCount: 0,
  warningCount: 0,
  publishable: true,
  requiredAcknowledgements: [],
};

export const CROSSING_VALIDATION: ValidationResult = {
  issues: [
    {
      code: 'boundary-crossing',
      severity: 'warning',
      message: 'The footprint crosses the campus boundary (80 % inside).',
      path: 'model.anchor',
      data: { pct: 80 },
    },
  ],
  errorCount: 0,
  warningCount: 1,
  publishable: true,
  requiredAcknowledgements: ['boundary-crossing'],
};

export function detail(
  over: Partial<StudioBuildingDetail> = {},
  d: StudioDraft = draft(),
): StudioBuildingDetail {
  return {
    head: head(),
    draft: d,
    published: null,
    validation: null,
    modelAvailable: true,
    unavailableReason: null,
    ...over,
  };
}

export function fakeStudioApi(): { [K in keyof StudioApi]: ReturnType<typeof vi.fn> } & StudioApi {
  const never = () => Promise.reject(new Error('not scripted'));
  return {
    library: vi.fn(never),
    createTemplate: vi.fn(never),
    updateTemplate: vi.fn(never),
    retireTemplate: vi.fn(never),
    unretireTemplate: vi.fn(never),
    listBuildings: vi.fn(async () => ok({ items: [], nextCursor: null })),
    getBuilding: vi.fn(never),
    createBuilding: vi.fn(never),
    saveDraft: vi.fn(never),
    discardDraft: vi.fn(never),
    validate: vi.fn(async () => ok(EMPTY_VALIDATION)),
    publish: vi.fn(never),
    archive: vi.fn(never),
    restore: vi.fn(never),
    deleteBuilding: vi.fn(never),
    duplicate: vi.fn(never),
    applyTemplate: vi.fn(never),
    quality: vi.fn(never),
  } as never;
}

/** In-memory storage for crash-recovery tests. */
export function memoryStorage(): RecoveryStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}
