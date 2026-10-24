import { useId, useRef, type KeyboardEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAnnounce } from '../../accessibility/index.ts';
import { useAppStore } from '../../app/store/index.ts';
import {
  VIEW_MODE_LABELS,
  VIEW_MODE_NAMES,
  VIEW_MODES,
  viewModeBlockedReason,
  type ViewMode,
} from '../../app/view-mode.ts';
import { Icon } from '../icons/Icon.tsx';
import type { IconName } from '../icons/icon-paths.ts';
import { cx, FOCUS_RING } from '../ui/cx.ts';

const ICONS: Record<ViewMode, IconName> = {
  realistic3d: 'cube',
  isometric: 'overview',
  standard2d: 'map-2d',
};

/**
 * The view-mode switcher (docs/ISOMETRIC_AND_3D_DESIGN.md §8.4, §8.5): one
 * radio group "View mode" with 3D map, Isometric overview and 2D map. An
 * option that cannot be used now (the overview during live navigation, the
 * map modes without WebGL) stays focusable with aria-disabled and its reason
 * as the description — never silently hidden. Changes are announced and
 * focus stays on the switcher. One tab stop; arrow keys, Home and End move.
 */
export function ViewModeSwitcher({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { viewMode, navigationActive, mapUnavailable } = useAppStore(
    useShallow((s) => ({
      viewMode: s.viewMode,
      navigationActive: s.navigationActive,
      mapUnavailable: s.mapUnavailable,
    })),
  );
  const announce = useAnnounce();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const baseId = useId();

  const choose = (mode: ViewMode) => {
    const reason = viewModeBlockedReason(mode, { navigationActive, mapUnavailable });
    if (reason) {
      announce(`${VIEW_MODE_NAMES[mode]}: ${reason}`);
      return;
    }
    if (mode === viewMode) return;
    if (useAppStore.getState().setViewMode(mode, { reason: 'user' }))
      announce(`${VIEW_MODE_NAMES[mode]} shown`);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const n = VIEW_MODES.length;
    let next: number | null = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (index + 1) % n;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (index - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next === null) return;
    e.preventDefault();
    refs.current[next]?.focus();
    choose(VIEW_MODES[next]!);
  };

  return (
    <div
      role="radiogroup"
      aria-label="View mode"
      className={cx(
        'flex flex-col overflow-hidden rounded-lg border border-border bg-surface-raised shadow-2',
        className,
      )}
    >
      {VIEW_MODES.map((mode, i) => {
        const checked = mode === viewMode;
        const reason = viewModeBlockedReason(mode, { navigationActive, mapUnavailable });
        const reasonId = `${baseId}-${mode}`;
        return (
          <button
            key={mode}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={VIEW_MODE_NAMES[mode]}
            aria-disabled={reason ? true : undefined}
            aria-describedby={reason ? reasonId : undefined}
            title={reason ? `${VIEW_MODE_NAMES[mode]} — ${reason}` : VIEW_MODE_NAMES[mode]}
            tabIndex={checked ? 0 : -1}
            data-mode={mode}
            onClick={() => choose(mode)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cx(
              'flex flex-col items-center justify-center gap-0.5 text-text transition-colors duration-fast',
              // Desktop: wide enough for the visible short label ("Overview") under the icon.
              compact ? 'size-8' : 'h-12 w-14',
              'pointer-coarse:min-h-11 pointer-coarse:min-w-11',
              FOCUS_RING,
              // Inset ring: the stack clips (overflow-hidden), so an outset ring would be cut off.
              'focus-visible:-outline-offset-2',
              checked ? 'bg-accent-soft text-accent-text' : 'hover:bg-surface-hover',
              reason && 'cursor-not-allowed opacity-50',
            )}
          >
            <Icon name={ICONS[mode]} size={compact ? 18 : 20} />
            {compact ? null : (
              <span aria-hidden="true" className="text-[0.625rem] leading-none font-semibold">
                {VIEW_MODE_LABELS[mode]}
              </span>
            )}
            {reason ? (
              <span id={reasonId} className="sr-only">
                {reason}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
