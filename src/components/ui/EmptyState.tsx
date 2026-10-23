import type { ReactNode } from 'react';
import { Icon } from '../icons/Icon.tsx';
import type { IconName } from '../icons/icon-paths.ts';
import { Button } from './Button.tsx';
import { cx } from './cx.ts';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: IconName;
  action?: ReactNode;
  className?: string;
}

/** Honest "nothing here" state, e.g. a category with no mapped records. */
export function EmptyState({ title, description, icon = 'info', action, className }: EmptyStateProps) {
  return (
    <div className={cx('flex flex-col items-center gap-2 px-6 py-8 text-center', className)}>
      <Icon name={icon} size={28} className="text-subtle" />
      <p className="text-base font-semibold text-text">{title}</p>
      {description ? <p className="max-w-prose text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export interface ErrorStateProps {
  title?: ReactNode;
  message: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  /** Retry in progress: the button shows a spinner and blocks repeat clicks. */
  retrying?: boolean;
  className?: string;
}

/** Failure state with an optional retry action; announced as an alert. */
export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  retryLabel = 'Try again',
  retrying = false,
  className,
}: ErrorStateProps) {
  return (
    <div role="alert" className={cx('flex flex-col items-center gap-2 px-6 py-8 text-center', className)}>
      <Icon name="warning" size={28} className="text-danger" />
      <p className="text-base font-semibold text-text">{title}</p>
      <p className="max-w-prose text-sm text-muted">{message}</p>
      {onRetry ? (
        <Button className="mt-2" icon="reset" loading={retrying} onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
