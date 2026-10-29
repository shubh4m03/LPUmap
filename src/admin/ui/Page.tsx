import type { ReactNode } from 'react';
import { Icon } from '../../components/icons/index.ts';
import { cx, FOCUS_RING } from '../../components/ui/index.ts';
import { onInAppClick } from './links.ts';

export interface PageProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** "Back to …" link above the title. */
  back?: { href: string; label: string; onNavigate(): void };
  /** Wider content (tables, map layouts). */
  wide?: boolean;
  children: ReactNode;
}

/** Admin screen frame: optional back link, heading, description, actions, content. */
export function Page({ title, description, actions, back, wide = false, children }: PageProps) {
  return (
    <div className={cx('mx-auto flex w-full flex-col gap-4 p-4 md:p-6', wide ? 'max-w-7xl' : 'max-w-4xl')}>
      {back ? (
        <a
          href={back.href}
          onClick={onInAppClick(back.onNavigate)}
          className={cx(
            'inline-flex min-h-10 w-fit items-center gap-1 rounded-md pe-2 text-sm font-medium text-accent-text hover:underline',
            FOCUS_RING,
          )}
        >
          <Icon name="chevron-left" size={18} />
          {back.label}
        </a>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-xl font-semibold break-words text-text">{title}</h1>
          {description ? <div className="max-w-prose text-sm text-muted">{description}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

/** A titled block inside a page. */
export function Section({
  title,
  children,
  actions,
  className,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={cx('flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4', className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-text">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Label / value rows (definition list). Values that are null show an em dash, never a guess. */
export function Facts({ items }: { items: ReadonlyArray<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(8rem,max-content)_1fr]">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-medium text-muted">{k}</dt>
          <dd className="min-w-0 break-words text-text">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
