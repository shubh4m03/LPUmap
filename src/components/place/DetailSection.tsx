import { useId, type ReactNode } from 'react';
import { Icon, type IconName } from '../ui/index.ts';

/** A titled block inside the place details. */
export function DetailSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: IconName;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="border-t border-border pt-3">
      <h4 id={id} className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-muted">
        <Icon name={icon} size={16} />
        {title}
      </h4>
      {children}
    </section>
  );
}

/** External link that always opens safely in a new tab, with a visible external marker. */
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 break-all text-accent-text underline underline-offset-2 hover:no-underline"
    >
      {children}
      <Icon name="external" size={14} />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}
