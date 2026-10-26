import { useMemo } from 'react';
import { useAppStore } from '../../app/store/index.ts';
import { Button } from '../ui/index.ts';
import { directorySummary } from './directory-view-model.ts';
import { ArtworkNumberGlyph, MapKeyGlyph } from './MapKeyGlyph.tsx';
import { useCampusDirectory } from './use-campus-directory.ts';

/**
 * Peek content of the mobile directory sheet (§8.4): the selected building or
 * illustration item, or "N campus buildings · Browse" when nothing in the
 * directory is selected.
 */
export function DirectoryPeek({ onBrowse }: { onBrowse(): void }) {
  const dir = useCampusDirectory();
  const selectedId = useAppStore((s) => s.selectedPlaceId);
  const selected = useMemo(() => (selectedId ? dir.item(selectedId) : undefined), [dir, selectedId]);
  if (selected) {
    return (
      <div className="flex items-center gap-3 px-4 py-1">
        {selected.kind === 'building' ? (
          <MapKeyGlyph mapKey={selected.entry.key} />
        ) : (
          <ArtworkNumberGlyph artworkNumber={selected.entry.artworkNumber} />
        )}
        {/* whitespace-pre (not truncate's nowrap): printed artwork labels keep their exact double spaces. */}
        <span className="min-w-0 flex-1 overflow-hidden text-sm font-medium text-ellipsis whitespace-pre text-text">
          {selected.entry.title}
        </span>
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
        {directorySummary({
          total: dir.entries.length,
          keyed,
          artworkOnly: dir.artwork?.entries.length ?? 0,
        })}
      </span>
      <Button size="sm" variant="secondary" onClick={onBrowse}>
        Browse
      </Button>
    </div>
  );
}
