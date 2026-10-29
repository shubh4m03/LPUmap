import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon } from '../icons/index.ts';
import type { IconName } from '../icons/index.ts';
import { cx, FOCUS_RING } from './cx.ts';

export interface ToggleChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  icon?: IconName;
  children: ReactNode;
}

/** On/off filter chip (aria-pressed). Pressed also shows a check mark, not only colour. */
export function ToggleChip({
  pressed,
  onPressedChange,
  icon,
  children,
  className,
  ...rest
}: ToggleChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onPressedChange(!pressed)}
      className={cx(
        'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium whitespace-nowrap',
        'transition-colors duration-fast pointer-coarse:min-h-11',
        pressed
          ? 'border-accent bg-accent-soft text-accent-text'
          : 'border-border-strong bg-surface-raised text-text hover:bg-surface-hover',
        FOCUS_RING,
        className,
      )}
      {...rest}
    >
      {pressed ? <Icon name="check" size={16} /> : icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </button>
  );
}
