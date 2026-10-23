import { useRef, type KeyboardEvent } from 'react';
import { Icon } from '../icons/Icon.tsx';
import type { IconName } from '../icons/icon-paths.ts';
import { cx, FOCUS_RING } from './cx.ts';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  /** Accessible name of the group (e.g. "Travel mode"). */
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Hide option text visually (icons only); text stays as the accessible name. */
  iconOnly?: boolean;
  className?: string;
}

/**
 * Single-choice control with radiogroup semantics: one tab stop (roving tabindex),
 * arrow keys move and select, Home/End jump; disabled options are skipped.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  iconOnly = false,
  className,
}: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  const selectedIndex = options.findIndex((o) => o.value === value);
  const tabIndexOwner = selectedIndex >= 0 && !options[selectedIndex]?.disabled ? selectedIndex : enabled[0];

  const move = (from: number, key: string) => {
    if (enabled.length === 0) return;
    const pos = enabled.indexOf(from);
    let nextPos: number;
    if (key === 'Home') nextPos = 0;
    else if (key === 'End') nextPos = enabled.length - 1;
    else if (key === 'ArrowRight' || key === 'ArrowDown') nextPos = (pos + 1) % enabled.length;
    else nextPos = (pos - 1 + enabled.length) % enabled.length;
    const idx = enabled[nextPos];
    const opt = idx === undefined ? undefined : options[idx];
    if (idx === undefined || !opt) return;
    refs.current[idx]?.focus();
    if (opt.value !== value) onChange(opt.value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      move(index, e.key);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx('inline-flex rounded-lg border border-border-strong bg-surface-sunken p-0.5', className)}
    >
      {options.map((opt, i) => {
        const checked = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={iconOnly ? opt.label : undefined}
            title={iconOnly ? opt.label : undefined}
            disabled={opt.disabled}
            tabIndex={i === tabIndexOwner ? 0 : -1}
            onClick={() => !checked && onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cx(
              'inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium',
              'transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11',
              checked ? 'bg-surface-raised text-accent-text shadow-1' : 'text-muted hover:text-text',
              FOCUS_RING,
            )}
          >
            {opt.icon ? <Icon name={opt.icon} size={18} /> : null}
            {iconOnly ? null : opt.label}
          </button>
        );
      })}
    </div>
  );
}
