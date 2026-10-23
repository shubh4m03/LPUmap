import type { ReactNode } from 'react';
import { Icon, cx, type IconName } from '../ui/index.ts';

export type NoticeTone = 'info' | 'warning' | 'danger' | 'success';

const TONE: Record<NoticeTone, { box: string; icon: IconName; iconClass: string; label: string }> = {
  info: { box: 'bg-info-soft', icon: 'info', iconClass: 'text-info', label: 'Note' },
  warning: { box: 'bg-warning-soft', icon: 'warning', iconClass: 'text-warning', label: 'Caution' },
  danger: { box: 'bg-danger-soft', icon: 'warning', iconClass: 'text-danger', label: 'Problem' },
  success: { box: 'bg-success-soft', icon: 'check', iconClass: 'text-success', label: 'Done' },
};

export interface NoticeProps {
  tone?: NoticeTone;
  /** Visible heading; defaults to a word for the tone so meaning never rests on colour. */
  title?: ReactNode;
  children?: ReactNode;
  /** 'alert' for errors that just appeared, 'status' for live updates, 'note' otherwise. */
  role?: 'alert' | 'status' | 'note';
  actions?: ReactNode;
  className?: string;
}

/** A text notice with an icon and a visible label; colour is only a secondary cue. */
export function Notice({ tone = 'info', title, children, role = 'note', actions, className }: NoticeProps) {
  const t = TONE[tone];
  return (
    <div role={role} className={cx('flex gap-2 rounded-md p-3 text-sm text-text', t.box, className)}>
      <Icon name={t.icon} size={18} className={cx('mt-0.5 shrink-0', t.iconClass)} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-semibold">{title ?? t.label}</p>
        {children ? <div className="text-text">{children}</div> : null}
        {actions ? <div className="mt-1 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
