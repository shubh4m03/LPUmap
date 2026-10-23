import { useAppStore } from '../../app/store/index.ts';
import { CATEGORIES } from '../../config/categories.ts';
import { Icon, cx, iconForCategory } from '../ui/index.ts';

const QUICK = CATEGORIES.filter((c) => c.nearestAction);

/** Category shortcuts ("Food", "ATM & bank", …) taken from CATEGORIES.nearestAction. */
export function QuickActions({ className }: { className?: string }) {
  const openCategory = useAppStore((s) => s.openCategory);
  return (
    <nav aria-label="Find nearby" className={className}>
      <ul className="flex gap-2 overflow-x-auto px-3 py-2 [scrollbar-width:none]">
        {QUICK.map((c) => (
          <li key={c.id} className="shrink-0">
            <button
              type="button"
              onClick={() => openCategory(c.id)}
              className={cx(
                'inline-flex h-11 items-center gap-1.5 rounded-full border border-border-strong bg-surface-raised px-3 text-sm font-medium whitespace-nowrap text-text',
                'hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
              )}
            >
              <Icon name={iconForCategory(c.icon)} size={18} style={{ color: c.color }} />
              {c.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
