import { useAppStore } from '../../app/store/index.ts';
import { Button } from '../ui/index.ts';
import { directorySummary } from './directory-view-model.ts';
import { MapKeyGlyph } from './MapKeyGlyph.tsx';
import { useCampusDirectory } from './use-campus-directory.ts';

/**
 * Peek content of the mobile directory sheet (§8.4): the selected building, or
 * "N campus buildings · Browse" when nothing in the directory is selected.
 */
export function DirectoryPeek({ onBrowse }: { onBrowse(): void }) {
  const dir = useCampusDirectory();
  const selected = useAppStore((s) => (s.selectedPlaceId ? dir.byId.get(s.selectedPlaceId) : undefined));
  if (selected) {
    return (
      <div className="flex items-center gap-3 px-4 py-1">
        <MapKeyGlyph mapKey={selected.key} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{selected.title}</span>
        <Button size="sm" variant="secondary" onClick={onBrowse}>
          Browse
        </Button>
      </div>
    );
  }
  const keyed = dir.entries.filter((e) => e.key !== null).length;
  return (
    <div className="flex items-center gap-3 px-4 py-1">
      <span className="line-clamp-2 min-w-0 flex-1 text-sm text-muted">
        {directorySummary({ total: dir.entries.length, keyed })}
      </span>
      <Button size="sm" variant="secondary" onClick={onBrowse}>
        Browse
      </Button>
    </div>
  );
}
