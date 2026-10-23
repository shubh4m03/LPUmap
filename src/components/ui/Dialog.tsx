import { useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '../../accessibility/useFocusTrap.ts';
import { IconButton } from './IconButton.tsx';
import { cx } from './cx.ts';
import { useModalPresence } from './modal-presence.ts';
import { useScrollLock } from './scroll-lock.ts';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Action row rendered below the content. */
  footer?: ReactNode;
  /** Focus target on open (prefer this over autoFocus so focus restore works). */
  initialFocus?: RefObject<HTMLElement | null>;
  size?: 'sm' | 'md' | 'lg';
  closeLabel?: string;
  /** Close when the scrim is clicked (default true). */
  dismissOnScrim?: boolean;
  className?: string;
}

const SIZE = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' } as const;

/**
 * Modal dialog rendered in a portal: aria-modal, labelled by its title, focus trapped,
 * Escape and scrim click close, body scroll locked, focus returned to the opener.
 */
export function Dialog({ open, ...props }: DialogProps) {
  if (!open || typeof document === 'undefined') return null;
  return createPortal(<DialogInner {...props} />, document.body);
}

function DialogInner({
  onClose,
  title,
  description,
  children,
  footer,
  initialFocus,
  size = 'md',
  closeLabel = 'Close',
  dismissOnScrim = true,
  className,
}: Omit<DialogProps, 'open'>) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useFocusTrap(panelRef, true, initialFocus ? { initialFocus } : {});
  useScrollLock(true);
  useModalPresence(true);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-(--ds-z-dialog) flex items-end justify-center sm:items-center sm:p-4">
      <div
        aria-hidden="true"
        data-testid="dialog-scrim"
        className="absolute inset-0 bg-overlay"
        onClick={dismissOnScrim ? onClose : undefined}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cx(
          'relative flex max-h-[min(90dvh,100%)] w-full flex-col rounded-t-xl bg-surface-raised text-text shadow-3 outline-none sm:rounded-xl',
          'pb-[var(--ds-safe-bottom)] sm:pb-0',
          SIZE[size],
          className,
        )}
      >
        <div className="flex items-start gap-3 border-b border-border px-5 pt-4 pb-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg leading-tight font-semibold">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-1 text-sm text-muted">
                {description}
              </p>
            ) : null}
          </div>
          <IconButton icon="close" label={closeLabel} size="sm" onClick={onClose} className="-mr-1" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
