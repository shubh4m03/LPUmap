import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { useFocusTrap } from '../../accessibility/useFocusTrap.ts';
import { IconButton } from './IconButton.tsx';
import { cx, FOCUS_RING } from './cx.ts';
import { closestSnap, nextSnap, type SheetSnap, snapHeightsPx } from './sheet-snap.ts';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  /** Visible heading; also the accessible name of the sheet. */
  title: ReactNode;
  /** Accessible name when it should say more than the visible title (default: the title). */
  label?: string;
  children?: ReactNode;
  /** Controlled snap point. Omit to let the sheet manage it (starting at `defaultSnap`). */
  snap?: SheetSnap;
  defaultSnap?: SheetSnap;
  onSnapChange?: (snap: SheetSnap) => void;
  /** Extra header content (e.g. actions) shown next to the title. */
  headerActions?: ReactNode;
  closeLabel?: string;
  className?: string;
}

const SNAP_LABEL: Record<SheetSnap, string> = { peek: 'collapsed', half: 'half height', full: 'full height' };

const SNAP_CSS: Record<SheetSnap, string> = {
  peek: 'calc(var(--ds-sheet-peek) + var(--ds-safe-bottom))',
  half: '50dvh',
  full: 'calc(100dvh - var(--ds-sheet-top-gap) - var(--ds-safe-top))',
};

/** Pointer travel below which a handle press counts as a tap (cycles snap). */
const TAP_SLOP_PX = 6;

/**
 * Mobile bottom sheet with peek/half/full snap points. Non-modal (role=region) at peek
 * and half so the map stays usable; at full it covers the map and becomes a modal
 * dialog with a focus trap. The close button is always visible.
 */
export function BottomSheet(props: BottomSheetProps) {
  if (!props.open) return null;
  return <BottomSheetInner {...props} />;
}

function BottomSheetInner({
  onClose,
  title,
  label,
  children,
  snap: controlledSnap,
  defaultSnap = 'half',
  onSnapChange,
  headerActions,
  closeLabel = 'Close',
  className,
}: BottomSheetProps) {
  const [internalSnap, setInternalSnap] = useState<SheetSnap>(defaultSnap);
  const snap = controlledSnap ?? internalSnap;
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; startH: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const titleId = useId();
  const hintId = useId();
  const modal = snap === 'full';

  useFocusTrap(sheetRef, modal, { restoreFocus: false });

  // On close, return focus to whatever had it at open time, but only if focus was
  // inside the sheet (it falls back to <body> when the sheet unmounts).
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const now = document.activeElement;
      if ((now === null || now === document.body) && opener?.isConnected) opener.focus();
    };
  }, []);

  const setSnap = (next: SheetSnap) => {
    if (controlledSnap === undefined) setInternalSnap(next);
    onSnapChange?.(next);
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const h = sheetRef.current?.getBoundingClientRect().height ?? 0;
    drag.current = { startY: e.clientY, startH: h, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = d.startY - e.clientY;
    if (!d.moved && Math.abs(dy) < TAP_SLOP_PX) return;
    d.moved = true;
    const max = snapHeightsPx(window.innerHeight).full;
    setDragHeight(Math.max(0, Math.min(max, d.startH + dy)));
  };

  const endDrag = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (!d?.moved) return;
    suppressClick.current = true;
    const finalH = Math.max(0, d.startH + (d.startY - e.clientY));
    setDragHeight(null);
    const target = closestSnap(finalH, window.innerHeight);
    if (target === 'close') onClose();
    else setSnap(target);
  };

  // A cancelled gesture (the browser took over, a call came in...) carries no reliable
  // position, so the sheet springs back to its current snap instead of guessing.
  const cancelDrag = (e: PointerEvent<HTMLButtonElement>) => {
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setDragHeight(null);
  };

  const onHandleClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    setSnap(nextSnap(snap));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  const dragging = dragHeight !== null;
  return (
    <div
      ref={sheetRef}
      role={modal ? 'dialog' : 'region'}
      aria-modal={modal || undefined}
      aria-labelledby={label ? undefined : titleId}
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-snap={snap}
      style={{ height: dragging ? `${dragHeight}px` : SNAP_CSS[snap] }}
      className={cx(
        'fixed inset-x-0 bottom-0 z-(--ds-z-sheet) flex flex-col rounded-t-xl border-t border-border',
        'bg-surface-raised text-text shadow-3 outline-none',
        !dragging && 'transition-[height] duration-slow ease-standard motion-reduce:transition-none',
        className,
      )}
    >
      <button
        type="button"
        aria-label={`Resize ${label ?? (typeof title === 'string' ? title : 'panel')}: ${SNAP_LABEL[snap]}`}
        aria-describedby={hintId}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={cancelDrag}
        onClick={onHandleClick}
        className={cx(
          'flex h-6 w-full shrink-0 cursor-grab touch-none items-center justify-center',
          FOCUS_RING,
        )}
      >
        <span aria-hidden="true" className="h-1 w-10 rounded-full bg-border-strong" />
      </button>
      <span id={hintId} hidden>
        Press Enter or Space to change height, or drag to resize.
      </span>
      <div className="flex shrink-0 items-center gap-2 pr-safe pb-2 pl-4">
        <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold">
          {title}
        </h2>
        {headerActions}
        <IconButton icon="close" label={closeLabel} size="sm" onClick={onClose} />
      </div>
      <div
        inert={snap === 'peek'}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-safe"
        data-testid="sheet-content"
      >
        {children}
      </div>
    </div>
  );
}
