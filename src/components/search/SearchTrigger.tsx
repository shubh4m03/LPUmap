import { useAppStore } from '../../app/store/index.ts';
import { Icon, Kbd, cx } from '../ui/index.ts';

const isApple = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform ?? '');

/** Button that looks like a search field and opens the command palette. */
export function SearchTrigger({ compact = false, className }: { compact?: boolean; className?: string }) {
  const openPalette = useAppStore((s) => s.openPalette);
  return (
    <button
      type="button"
      onClick={() => openPalette()}
      aria-haspopup="dialog"
      data-search-trigger=""
      aria-keyshortcuts="Control+K Meta+K /"
      className={cx(
        'flex h-12 w-full min-w-0 items-center gap-3 rounded-full border border-border bg-surface-raised px-4 text-left text-text shadow-2',
        'hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        className,
      )}
    >
      <Icon name="search" className="text-muted" />
      <span className="min-w-0 flex-1 truncate text-sm text-muted">
        {compact ? 'Search places, categories' : 'Search places, categories, commands'}
      </span>
      {compact ? null : (
        <span aria-hidden="true" className="hidden shrink-0 items-center gap-1 sm:flex">
          <Kbd>{isApple() ? '⌘' : 'Ctrl'}</Kbd>
          <Kbd>K</Kbd>
        </span>
      )}
    </button>
  );
}
