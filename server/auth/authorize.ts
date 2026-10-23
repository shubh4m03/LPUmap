/**
 * Authorization. First release: a single role `owner` with every
 * permission; permission names exist so moderators can be added later.
 */
import { HttpError } from '../http/errors.ts';

export const PERMISSIONS = [
  'admin:read',
  'suggestions:review',
  'locations:write',
  'locations:delete',
  'overrides:write',
  'audit:read',
  'audit:revert',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export type Role = 'owner';

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
};

export interface Actor {
  /** Recorded in audit: the Access email, or 'owner' in password mode. */
  id: string;
  role: Role;
  mode: 'access' | 'password';
  /** Present in password mode. */
  session?: { idHash: string; csrfToken: string; expiresAt: string };
}

export function can(actor: Actor, permission: Permission): boolean {
  return ROLE_PERMISSIONS[actor.role]?.includes(permission) ?? false;
}

export function authorize(actor: Actor, permission: Permission): void {
  if (!can(actor, permission)) throw new HttpError('forbidden', 'Not allowed');
}
