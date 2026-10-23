/** Shared domain validation: request bodies, contribution area and access points. */
import { z } from 'zod';
import { accessPointSchema } from '../../src/community/schema.ts';
import { checkAccessNode, insideContributionArea } from '../../src/community/geo.ts';
import type { LngLat } from '../../src/data/schema.ts';
import type { BaseData } from '../base-data.ts';
import { fail, parseOrThrow, unprocessable } from '../errors.ts';

export const revisionSchema = z.number().int().positive();

export function requireObject(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('invalid', `${what} must be a JSON object.`, {
      issues: [{ path: '(root)', message: 'Expected an object' }],
    });
  }
  return value as Record<string, unknown>;
}

export function requireRevision(value: unknown): number {
  return parseOrThrow(revisionSchema, value, 'revision', { prefix: 'revision' });
}

export function assertInArea(location: LngLat, path = 'location'): void {
  if (!insideContributionArea(location)) {
    fail('outside-area', 'The location must be on or near the LPU campus (inside the map area).', {
      issues: [{ path, message: 'Outside the contribution area' }],
    });
  }
}

export interface AccessResult {
  accessNodeId: number | null;
  accessNote: string | null;
}

/** Validates an owner-asserted access node for `location`; 422 with a clear message otherwise. Never snaps. */
export function validateAccessPoint(base: BaseData, raw: unknown, location: LngLat | null): AccessResult {
  const ap = parseOrThrow(accessPointSchema, raw, 'accessPoint', { prefix: 'accessPoint' });
  if (!location) return unprocessable('accessPoint', 'An access point needs a map position for the place.');
  const check = checkAccessNode(base.graphNodes, base.footNodes, ap.nodeId, location);
  if (!check.ok) return unprocessable('accessPoint.nodeId', check.message);
  return { accessNodeId: check.nodeId, accessNote: ap.note ?? null };
}

/** Re-checks an already-stored node after the location moved. */
export function revalidateKeptAccess(base: BaseData, nodeId: number, location: LngLat): void {
  const check = checkAccessNode(base.graphNodes, base.footNodes, nodeId, location);
  if (!check.ok) {
    unprocessable(
      'accessPoint',
      `The location moved and its current access point is no longer valid: ${check.message} Choose a new access point or clear it.`,
    );
  }
}

/** True for C0 control characters or DEL other than tab, LF and CR. */
function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0x7f) return true;
  }
  return false;
}

/** Optional single-line private note (≤ 1000 chars); '' → null. */
export const noteSchema = z
  .string()
  .trim()
  .max(1000)
  .refine((s) => !hasControlChars(s), { message: 'Control characters are not allowed' })
  .transform((s) => (s === '' ? null : s));

export function optionalNote(value: unknown, path: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return parseOrThrow(noteSchema, value, path, { prefix: path });
}
