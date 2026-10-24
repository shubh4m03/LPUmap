import { spokenMapKey } from '../../isometric/labels.ts';

/**
 * The map-key glyph (Decision D6): a diamond, never a circle, with the key in
 * monospace. Screen readers hear "Map key C 4, 7". Entries without a key get
 * an empty slot so titles stay aligned.
 */
export function MapKeyGlyph({ mapKey }: { mapKey: string | null }) {
  if (!mapKey) return <span aria-hidden="true" className="mt-0.5 inline-block w-16 shrink-0" />;
  return (
    <span className="mt-0.5 inline-flex w-16 shrink-0 items-center gap-1.5">
      <span
        aria-hidden="true"
        className="inline-block size-2.5 shrink-0 rotate-45 border-2 border-text bg-surface"
      />
      <span aria-hidden="true" className="font-mono text-xs font-semibold text-text">
        {mapKey}
      </span>
      <span className="sr-only">{spokenMapKey(mapKey)}</span>
    </span>
  );
}
