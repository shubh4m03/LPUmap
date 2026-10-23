import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { Icon } from '../icons/Icon.tsx';
import type { IconName } from '../icons/icon-paths.ts';
import { BUTTON_BASE, cx } from './cx.ts';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, sets aria-busy and blocks activation. The label stays visible. */
  loading?: boolean;
  icon?: IconName;
  iconPosition?: 'start' | 'end';
  fullWidth?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-contrast hover:bg-accent-hover',
  secondary: 'bg-surface-raised text-text border border-border-strong hover:bg-surface-hover',
  ghost: 'bg-transparent text-text hover:bg-surface-hover',
  danger: 'bg-danger text-surface hover:opacity-90',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-5 text-base gap-2',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  iconPosition = 'start',
  fullWidth = false,
  type = 'button',
  className,
  children,
  disabled,
  onClick,
  ref,
  ...rest
}: ButtonProps) {
  const iconSize = size === 'lg' ? 20 : 18;
  let lead: ReactNode = icon && iconPosition === 'start' ? <Icon name={icon} size={iconSize} /> : null;
  if (loading) lead = <SpinnerGlyph size={iconSize} />;
  return (
    <button
      ref={ref}
      type={type}
      className={cx(BUTTON_BASE, VARIANT[variant], SIZE[size], fullWidth && 'w-full', className)}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={loading ? (e) => e.preventDefault() : onClick}
      {...rest}
    >
      {lead}
      {children}
      {icon && iconPosition === 'end' && !loading ? <Icon name={icon} size={iconSize} /> : null}
    </button>
  );
}

/** Decorative rotating ring; the owning control carries the accessible state. */
export function SpinnerGlyph({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={cx('shrink-0 animate-spin motion-reduce:animate-none', className)}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2.5"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
