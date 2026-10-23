import { SpinnerGlyph } from './Button.tsx';
import { cx } from './cx.ts';

export interface SpinnerProps {
  /** Required: what is loading. Never show an unexplained infinite spinner. */
  label: string;
  /** Show the label next to the spinner (default true); otherwise it is screen-reader only. */
  showLabel?: boolean;
  size?: number;
  className?: string;
}

export function Spinner({ label, showLabel = true, size = 20, className }: SpinnerProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      className={cx('inline-flex items-center gap-2 text-sm text-muted', className)}
    >
      <SpinnerGlyph size={size} className="text-accent" />
      <span className={showLabel ? undefined : 'sr-only'}>{label}</span>
    </div>
  );
}

export interface SkeletonProps {
  /** Required: what is loading, announced to assistive technology. */
  label: string;
  lines?: number;
  className?: string;
}

/** Placeholder bars for content that is loading; the bars themselves are hidden from AT. */
export function Skeleton({ label, lines = 3, className }: SkeletonProps) {
  return (
    <div role="status" aria-busy="true" className={cx('flex flex-col gap-2', className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: Math.max(1, lines) }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          data-testid="skeleton-line"
          className={cx(
            'block h-3.5 animate-pulse rounded-sm bg-surface-hover motion-reduce:animate-none',
            i === lines - 1 && lines > 1 ? 'w-3/5' : 'w-full',
          )}
        />
      ))}
    </div>
  );
}
