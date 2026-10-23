import { useId, type ReactNode } from 'react';
import { cx, FOCUS_RING } from './cx.ts';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/** Labelled on/off switch (role=switch). The visible label is clickable. */
export function Switch({ checked, onCheckedChange, label, description, disabled, className }: SwitchProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const descId = `${id}-desc`;
  return (
    <div className={cx('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <label id={labelId} htmlFor={id} className="text-sm font-medium text-text">
          {label}
        </label>
        {description ? (
          <p id={descId} className="text-sm text-muted">
            {description}
          </p>
        ) : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={description ? descId : undefined}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cx(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-fast',
          'disabled:cursor-not-allowed disabled:opacity-50',
          // Invisible hit-area extension to 44px on touch screens.
          'pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5',
          checked ? 'border-accent bg-accent' : 'border-border-strong bg-surface-sunken',
          FOCUS_RING,
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            'inline-block size-4 rounded-full shadow-1 transition-transform duration-fast',
            checked ? 'translate-x-6 bg-accent-contrast' : 'translate-x-1 bg-border-strong',
          )}
        />
      </button>
    </div>
  );
}
