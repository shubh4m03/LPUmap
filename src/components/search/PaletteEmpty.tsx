import { useAppStore } from '../../app/store/index.ts';
import { CATEGORIES } from '../../config/categories.ts';
import { Button, EmptyState, iconForCategory } from '../ui/index.ts';

/** Honest no-match state: most campus buildings simply have no name in OpenStreetMap yet. */
export function PaletteEmpty({ query }: { query: string }) {
  const openReport = useAppStore((s) => s.openReport);
  return (
    <EmptyState
      icon="search"
      title={`No mapped place matches “${query}”.`}
      description="Most campus buildings are not yet named in OpenStreetMap, so many real places cannot be found by name. Try a category such as food or ATM, or browse the map."
      action={
        <Button
          variant="secondary"
          icon="flag"
          onClick={() => openReport({ kind: 'missing-facility', placeName: query.slice(0, 200) })}
        >
          Report missing place
        </Button>
      }
    />
  );
}

/** Shown for an empty query when there are no recent or saved places yet. */
export function PaletteIdleHint() {
  const openCategory = useAppStore((s) => s.openCategory);
  const closePalette = useAppStore((s) => s.closePalette);
  const quick = CATEGORIES.filter((c) => c.nearestAction);
  return (
    <div className="flex flex-col gap-3 py-2">
      <p className="text-sm text-muted">
        Type a place, a need (“food”, “atm”) or a command (“dark”, “layers”). Places you open appear here.
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Browse a category">
        {quick.map((c) => (
          <Button
            key={c.id}
            size="sm"
            variant="secondary"
            icon={iconForCategory(c.icon)}
            onClick={() => {
              closePalette();
              openCategory(c.id);
            }}
          >
            {c.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
