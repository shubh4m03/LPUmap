import type { ReactNode } from 'react';
import type { VerificationStatus } from '../../data/index.ts';
import { Icon } from '../icons/index.ts';
import type { IconName } from '../icons/index.ts';
import { cx } from './cx.ts';
import { VERIFICATION_BADGE, type BadgeTone } from './badge-meta.ts';

export interface BadgeProps {
  tone?: BadgeTone;
  icon?: IconName;
  children: ReactNode;
  className?: string;
}

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-surface-sunken text-muted border-border',
  accent: 'bg-accent-soft text-accent-text border-transparent',
  success: 'bg-success-soft text-success border-transparent',
  warning: 'bg-warning-soft text-warning border-transparent',
  danger: 'bg-danger-soft text-danger border-transparent',
  info: 'bg-info-soft text-info border-transparent',
};

/** Small status label. Always carries text; colour is never the only signal. */
export function Badge({ tone = 'neutral', icon, children, className }: BadgeProps) {
  return (
    <span
      className={cx(
        'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs leading-5 font-medium',
        TONE[tone],
        className,
      )}
    >
      {icon ? <Icon name={icon} size={14} /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Data-provenance badge: text label plus icon, with the meaning as a tooltip. */
export function VerificationBadge({ status, className }: { status: VerificationStatus; className?: string }) {
  const meta = VERIFICATION_BADGE[status];
  return (
    <span title={meta.description} className="inline-flex">
      <Badge tone={meta.tone} icon={meta.icon} className={className}>
        {meta.label}
      </Badge>
    </span>
  );
}
