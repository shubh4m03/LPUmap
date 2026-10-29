import { spokenMapKey } from '../../isometric/index.ts';

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

/**
 * The illustration's own number (a white disc on the artwork): a circle, so it
 * is never mistaken for a map key (diamond). Screen readers hear "Number 25 on
 * the illustration". Items without a number get an empty slot.
 */
export function ArtworkNumberGlyph({ artworkNumber }: { artworkNumber: string | null }) {
  if (!artworkNumber) return <span aria-hidden="true" className="mt-0.5 inline-block w-16 shrink-0" />;
  return (
    <span className="mt-0.5 inline-flex w-16 shrink-0 items-center">
      <span
        aria-hidden="true"
        className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-text bg-surface px-1 font-mono text-xs font-semibold text-text"
      >
        {artworkNumber}
      </span>
      <span className="sr-only">Number {artworkNumber} on the illustration</span>
    </span>
  );
}
