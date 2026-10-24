/** fetch mock + record builders for the admin API tests (no network). */
import type { StudioBuildingDetail, StudioBuildingHead } from '../../../src/building-studio/schema.ts';
import type { LocationRecord, SuggestionRecord } from '../../../src/admin/api/schemas.ts';
import { draft, STU_ID, T } from '../building-studio/fixtures.ts';

export interface Call {
  url: string;
  path: string;
  search: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  init: RequestInit;
}

export type Reply = Response | Error | ((call: Call) => Response | Error);

/** Replies are consumed in order; the last one repeats (a function builds a fresh reply per call). */
export function mockFetch(...replies: Reply[]): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const u = new URL(url, 'https://atlas.example');
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const call: Call = {
      url,
      path: u.pathname,
      search: u.search,
      method: init.method ?? 'GET',
      headers,
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : init.body,
      init,
    };
    calls.push(call);
    const r = replies[Math.min(i, replies.length - 1)];
    i++;
    const out = typeof r === 'function' ? r(call) : r;
    if (out === undefined) throw new Error('No reply configured');
    if (out instanceof Error) throw out;
    // Shared Response objects are cloned (bodies are single-use); a function's fresh reply is returned as is.
    return typeof r === 'function' ? out : out.clone();
  };
  return { fetch: fetchImpl as typeof fetch, calls };
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });

export const problem = (
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): Response => json({ error: { code, message, ...extra } }, status);

export const SUG_ID = 'sug_abcdefghijklmnopqrstuvwxyz';
export const OWN_ID = 'own:abcdefghijklmnopqrstuvwxyz';
export const STV_ID = 'stv:abcdefghijklmnopqrstuvwxyz';
export const TARGET = 'osm:way/123456';

export function suggestion(over: Partial<SuggestionRecord> = {}): SuggestionRecord {
  return {
    id: SUG_ID,
    status: 'pending',
    name: 'Photocopy shop',
    categoryId: 'shop',
    location: [75.7032, 31.2533],
    description: null,
    landmark: null,
    evidenceUrl: null,
    details: null,
    duplicateOf: null,
    reviewNote: null,
    reviewedBy: null,
    reviewedAt: null,
    publishedLocationId: null,
    createdAt: T,
    updatedAt: T,
    revision: 1,
    ...over,
  };
}

export function location(over: Partial<LocationRecord> = {}): LocationRecord {
  return {
    id: OWN_ID,
    origin: 'owner',
    suggestionId: null,
    name: 'Photocopy shop',
    categoryId: 'shop',
    location: [75.7032, 31.2533],
    description: null,
    openingHours: null,
    wheelchair: 'unknown',
    website: null,
    sourceUrl: null,
    verificationStatus: 'unverified',
    lastVerifiedAt: null,
    accessNodeId: null,
    accessNote: null,
    status: 'active',
    createdBy: 'owner',
    createdAt: T,
    updatedBy: 'owner',
    updatedAt: T,
    revision: 1,
    ...over,
  };
}

export function studioHead(over: Partial<StudioBuildingHead> = {}): StudioBuildingHead {
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

export function studioDetail(over: Partial<StudioBuildingDetail> = {}): StudioBuildingDetail {
  return {
    head: studioHead(),
    draft: draft(),
    published: null,
    validation: null,
    modelAvailable: true,
    unavailableReason: null,
    ...over,
  };
}
