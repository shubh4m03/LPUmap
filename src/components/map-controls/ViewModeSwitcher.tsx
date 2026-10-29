import { useContext, useId, useRef, type KeyboardEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAnnounce } from '../../accessibility/index.ts';
import { useAppStore } from '../../app/store/index.ts';
import {
  VIEW_MODE_DESCRIPTIONS,
  VIEW_MODE_LABELS,
  VIEW_MODE_NAMES,
  VIEW_MODE_OPTIONS,
  viewModeBlockedReason,
  type ViewMode,
} from '../../app/view-mode.ts';
import { PHOTOREAL_UNAVAILABLE_DETAIL } from '../../map/providers/index.ts';
import { Icon } from '../icons/index.ts';
import type { IconName } from '../icons/index.ts';
import { cx, FOCUS_RING } from '../ui/index.ts';
import { ToastContext } from '../ui/index.ts';

const ICONS: Record<ViewMode, IconName> = {
  realistic3d: 'cube',
  isometric: 'overview',
  standard2d: 'map-2d',
  satellite2d: 'globe',
  photoreal3d: 'building',
};

/** Options in the owner's order (docs/MAP_PROVIDER_CONFIGURATION.md §Modes). */
const OPTIONS = VIEW_MODE_OPTIONS;

/**
 * The view-mode switcher (docs/ISOMETRIC_AND_3D_DESIGN.md §8.4, §8.5;
 * MAP_PROVIDER_CONFIGURATION.md §Modes): one radio group "View mode" with the
 * five modes Satellite 2D, Photorealistic 3D, 3D map (Campus 3D), Isometric
 * overview and 2D map (Campus map 2D). An option that cannot be used now
 * (satellite without a configured free source or after a provider failure,
 * photorealistic 3D always, the overview during live navigation, the map
 * modes without WebGL) stays focusable with aria-disabled and its reason as
 * the description — never silently hidden, never faked. Choosing it shows the
 * reason (a toast, so touch users see it too) instead of switching. Changes
 * are announced and focus stays on the switcher. One tab stop; arrow keys,
 * Home and End move.
 */
export function ViewModeSwitcher({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { viewMode, navigationActive, mapUnavailable, availability } = useAppStore(
    useShallow((s) => ({
      viewMode: s.viewMode,
      navigationActive: s.navigationActive,
      mapUnavailable: s.mapUnavailable,
      availability: s.availability,
    })),
  );
  const announce = useAnnounce();
  const toast = useContext(ToastContext);
  const blocked = (mode: ViewMode) =>
    viewModeBlockedReason(mode, { navigationActive, mapUnavailable, availability });
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const baseId = useId();

  const choose = (mode: ViewMode) => {
    const reason = blocked(mode);
    if (reason) {
      announce(`${VIEW_MODE_NAMES[mode]}: ${reason}`);
      // Photorealistic 3D gets the full explanation (why there is no source, what Campus 3D is).
      // (The detail already starts with the mode's name.)
      const message =
        mode === 'photoreal3d' ? PHOTOREAL_UNAVAILABLE_DETAIL : `${VIEW_MODE_NAMES[mode]}: ${reason}`;
      toast?.show({ message, tone: 'neutral', durationMs: 10000 });
      return;
    }
    if (mode === viewMode) return;
    if (useAppStore.getState().setViewMode(mode, { reason: 'user' }))
      announce(`${VIEW_MODE_NAMES[mode]} shown`);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const n = OPTIONS.length;
    let next: number | null = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (index + 1) % n;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (index - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next === null) return;
    e.preventDefault();
    refs.current[next]?.focus();
    choose(OPTIONS[next]!);
  };

  return (
    <div
      role="radiogroup"
      aria-label="View mode"
      className={cx(
        'overflow-hidden rounded-lg border border-border bg-surface-raised shadow-2',
        // Phones: two columns, so five 44 px options take no more height than three did and the
        // control column stays clear of the bottom sheet and the map attribution.
        compact ? 'grid grid-cols-2' : 'flex flex-col',
        className,
      )}
    >
      {OPTIONS.map((mode, i) => {
        const checked = mode === viewMode;
        const reason = blocked(mode);
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
            title={
              reason
                ? `${VIEW_MODE_NAMES[mode]} — ${reason}`
                : `${VIEW_MODE_NAMES[mode]} — ${VIEW_MODE_DESCRIPTIONS[mode]}`
            }
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
