import type { ButtonHTMLAttributes, Ref } from 'react';
import { Icon } from '../icons/index.ts';
import type { IconName } from '../icons/index.ts';
import { BUTTON_BASE, cx } from './cx.ts';

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'children'
> {
  icon: IconName;
  /** Required: the only accessible name an icon-only button has. Also used as the tooltip. */
  label: string;
  variant?: 'ghost' | 'secondary' | 'primary';
  size?: 'sm' | 'md' | 'lg';
  /** Show `label` as a native tooltip (default true). */
  tooltip?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

const VARIANT = {
  ghost: 'bg-transparent text-text hover:bg-surface-hover',
  secondary: 'bg-surface-raised text-text border border-border-strong shadow-1 hover:bg-surface-hover',
  primary: 'bg-accent text-accent-contrast hover:bg-accent-hover',
} as const;

const SIZE = { sm: 'size-8', md: 'size-10', lg: 'size-12' } as const;

export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  tooltip = true,
  type = 'button',
  className,
  ref,
  ...rest
}: IconButtonProps) {
  if (import.meta.env.DEV && !label.trim()) {
    console.error('IconButton requires a non-empty label for its accessible name.');
  }
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={tooltip ? label : undefined}
      className={cx(BUTTON_BASE, 'shrink-0 p-0', VARIANT[variant], SIZE[size], className)}
      {...rest}
    >
      <Icon name={icon} size={size === 'sm' ? 18 : 20} />
    </button>
  );
}
