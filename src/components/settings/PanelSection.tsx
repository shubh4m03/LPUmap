import { useId, type ReactNode } from 'react';
import { cx, Icon, type IconName } from '../ui/index.ts';

/**
 * Titled block inside a side panel or sheet (settings, about, campus info,
 * saved places). The panel title itself is an h2 rendered by the shell, so
 * sections use h3 and are exposed as named regions.
 */
export function PanelSection({
  title,
  icon,
  description,
  children,
  className,
}: {
  title: string;
  icon?: IconName;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cx('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-1">
        <h3 id={id} className="flex items-center gap-1.5 text-sm font-semibold text-text">
          {icon ? <Icon name={icon} size={16} className="text-muted" /> : null}
          {title}
        </h3>
        {description ? <p className="text-sm text-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Two-column term/value list for small fact tables (versions, counts). */
export function FactList({ items, label }: { items: ReadonlyArray<[string, ReactNode]>; label?: string }) {
  return (
    <dl aria-label={label} className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      {items.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted">{term}</dt>
          <dd className="min-w-0 font-medium break-words text-text">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
