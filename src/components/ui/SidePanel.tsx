import { useId, type ReactNode } from 'react';
import { IconButton } from './IconButton.tsx';
import { cx } from './cx.ts';

export interface SidePanelProps {
  title: ReactNode;
  /** Accessible name when it should say more than the visible title (default: the title). */
  label?: string;
  children?: ReactNode;
  /** Renders a close button when provided. */
  onClose?: () => void;
  closeLabel?: string;
  side?: 'left' | 'right';
  headerActions?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/** Desktop side panel: a labelled complementary landmark with a scrolling body. */
export function SidePanel({
  title,
  label,
  children,
  onClose,
  closeLabel = 'Close panel',
  side = 'left',
  headerActions,
  footer,
  className,
}: SidePanelProps) {
  const titleId = useId();
  return (
    <aside
      aria-labelledby={label ? undefined : titleId}
      aria-label={label}
      className={cx(
        'flex h-full w-full max-w-sm flex-col bg-surface-raised text-text shadow-2',
        side === 'left' ? 'border-r border-border' : 'border-l border-border',
        className,
      )}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold">
          {title}
        </h2>
        {headerActions}
        {onClose ? <IconButton icon="close" label={closeLabel} size="sm" onClick={onClose} /> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      {footer ? <div className="shrink-0 border-t border-border px-4 py-3">{footer}</div> : null}
    </aside>
  );
}
