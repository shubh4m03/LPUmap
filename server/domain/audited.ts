/**
 * Wraps a privileged operation so that attempts which reach the domain but do
 * not succeed are audited too: DomainError → outcome 'rejected' (with its code
 * and message), anything else → outcome 'failed' and a generic
 * DomainError('internal'). Successful operations write their own audit row in
 * the same batch as the change. Audit snapshots never contain secrets/IPs.
 */
import { insertAudit } from '../db/audit.ts';
import type { AuditEntityType } from '../db/records.ts';
import type { SqlDatabase } from '../db/types.ts';
import { DomainError, isDomainError } from '../errors.ts';
import { isoNow, requireActor, type DomainContext } from './context.ts';

export interface AuditTarget {
  action: string;
  entityType: AuditEntityType;
  entityId: string | null;
}

export async function audited<T>(
  db: SqlDatabase,
  ctx: DomainContext,
  target: AuditTarget,
  fn: (actor: string) => Promise<T>,
): Promise<T> {
  const actor = requireActor(ctx);
  try {
    return await fn(actor);
  } catch (err) {
    const domain = isDomainError(err);
    try {
      await insertAudit(db, {
        at: isoNow(ctx),
        actor,
        action: target.action,
        entityType: target.entityType,
        entityId: target.entityId,
        outcome: domain ? 'rejected' : 'failed',
        detail: domain ? `${err.code}: ${err.message}` : 'Unexpected error; no change was saved.',
      });
    } catch {
      // The audit write itself failed (e.g. database unavailable); the original error still propagates.
    }
    if (domain) throw err;
    throw new DomainError('internal', 'The change could not be saved; nothing was changed.', { cause: err });
  }
}
