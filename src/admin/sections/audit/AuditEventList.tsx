import { Badge } from '../../../components/ui/Badge.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import { cx, FOCUS_RING } from '../../../components/ui/cx.ts';
import type { AuditEvent } from '../../api/schemas.ts';
import type { AdminNavigate } from '../../router.ts';
import { adminHref } from '../../routes.ts';
import { formatDateTime } from '../../ui/format.ts';
import { onInAppClick } from '../../ui/links.ts';
import {
  actionLabel,
  canRevert,
  displayValue,
  ENTITY_LABELS,
  entityRoute,
  fieldChanges,
} from './audit-model.ts';

export interface AuditEventListProps {
  events: readonly AuditEvent[];
  navigate: AdminNavigate;
  /** Hide the entity column (the list is already about one record). */
  compact?: boolean;
  /** Offer "Revert…" on revertable events. */
  onRevert?(event: AuditEvent): void;
}

const OUTCOME_TONE = { success: 'success', rejected: 'warning', failed: 'danger' } as const;

export function AuditEventList({ events, navigate, compact = false, onRevert }: AuditEventListProps) {
  return (
    <ol className="flex flex-col gap-2" aria-label="History events">
      {events.map((e) => {
        const changes = fieldChanges(e.before, e.after);
        const route = compact ? null : entityRoute(e);
        return (
          <li
            key={e.id}
            className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3 text-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="flex flex-wrap items-center gap-2 font-medium text-text">
                  {actionLabel(e.action)}
                  {e.outcome !== 'success' ? <Badge tone={OUTCOME_TONE[e.outcome]}>{e.outcome}</Badge> : null}
                </p>
                <p className="text-muted">
                  {formatDateTime(e.at)} · {e.actor}
                  {!compact ? ` · ${ENTITY_LABELS[e.entityType]}` : ''}
                  {!compact && e.entityId ? ' ' : ''}
                  {!compact && e.entityId ? (
                    route ? (
                      <a
                        href={adminHref(route)}
                        onClick={onInAppClick(() => navigate(route))}
                        className={cx('break-all text-accent-text underline', FOCUS_RING)}
                      >
                        {e.entityId}
                      </a>
                    ) : (
                      <span className="break-all">{e.entityId}</span>
                    )
                  ) : null}
                </p>
                {e.detail ? <p className="break-words text-text">{e.detail}</p> : null}
              </div>
              {onRevert && canRevert(e) ? (
                <Button size="sm" icon="reset" onClick={() => onRevert(e)}>
                  Revert…
                </Button>
              ) : null}
            </div>
            {changes.length > 0 ? (
              <details>
                <summary className={cx('cursor-pointer rounded-sm text-accent-text', FOCUS_RING)}>
                  {changes.length === 1 ? '1 field' : `${changes.length} fields`}
                </summary>
                <table className="mt-2 w-full table-fixed border-collapse text-left">
                  <thead>
                    <tr className="text-muted">
                      <th scope="col" className="w-1/4 py-1 pe-2 font-medium">
                        Field
                      </th>
                      <th scope="col" className="py-1 pe-2 font-medium">
                        Before
                      </th>
                      <th scope="col" className="py-1 font-medium">
                        After
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {changes.map((c) => (
                      <tr key={c.field} className="border-t border-border align-top">
                        <th scope="row" className="py-1 pe-2 font-medium break-words text-text">
                          {c.field}
                        </th>
                        <td className="py-1 pe-2 break-words text-muted">{displayValue(c.before)}</td>
                        <td className="py-1 break-words text-text">{displayValue(c.after)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
