import type { ReactNode } from 'react';
import { Button } from '../../components/ui/Button.tsx';
import { Icon } from '../../components/icons/Icon.tsx';
import { cx } from '../../components/ui/cx.ts';
import { describeAdminError, type AdminApiError } from '../api/errors.ts';

export interface ErrorNoticeProps {
  error: AdminApiError;
  /** What failed, e.g. "Could not approve the suggestion". */
  title?: string;
  /** Reload the record (shown for conflicts, unknown outcomes and load failures). */
  onReload?: () => void;
  reloadLabel?: string;
  onDismiss?: () => void;
  children?: ReactNode;
  className?: string;
}

/**
 * One failed request, stated truthfully: what happened, whether anything may
 * have been saved (`outcomeUnknown`), field issues, and the way forward
 * (reload the current version after a conflict, wait after a rate limit).
 */
export function ErrorNotice({
  error,
  title,
  onReload,
  reloadLabel,
  onDismiss,
  children,
  className,
}: ErrorNoticeProps) {
  const offerReload = onReload !== undefined;
  const label =
    reloadLabel ??
    (error.kind === 'conflict'
      ? 'Load the current version'
      : error.outcomeUnknown
        ? 'Reload to check'
        : 'Try again');
  return (
    <div
      role="alert"
      className={cx(
        'flex flex-col gap-2 rounded-md border border-danger/40 bg-danger-soft p-3 text-sm text-text',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <Icon name="warning" size={18} className="mt-0.5 shrink-0 text-danger" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {title ? <p className="font-semibold">{title}</p> : null}
          <p>{describeAdminError(error)}</p>
          {error.issues.length > 0 ? (
            <ul className="list-disc ps-5 text-muted">
              {error.issues.map((i) => (
                <li key={`${i.path}:${i.message}`}>
                  {i.path && i.path !== '(root)' ? <code className="text-text">{i.path}</code> : null}
                  {i.path && i.path !== '(root)' ? ': ' : null}
                  {i.message}
                </li>
              ))}
            </ul>
          ) : null}
          {children}
        </div>
      </div>
      {offerReload || onDismiss ? (
        <div className="flex flex-wrap justify-end gap-2">
          {onDismiss ? (
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              Dismiss
            </Button>
          ) : null}
          {offerReload ? (
            <Button size="sm" variant="secondary" icon="reset" onClick={onReload}>
              {label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
