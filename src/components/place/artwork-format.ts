/**
 * Wording and actions of the campus illustration in the details panel
 * (kept out of .tsx so components stay fast-refresh friendly).
 */
import { useAtlas } from '../../app/data/atlas-context.ts';
import { useAppStore } from '../../app/store/index.ts';
import type { DirectoryEntry } from '../../directory/index.ts';
import type { ArtworkLabelView } from '../../isometric-art/index.ts';
import type { AssociationEvidence } from '../../isometric-art/index.ts';
import { setRequestedIsometricVariant, useRequestedIsometricVariant } from '../../app/isometric-variant.ts';
import { ARTWORK_NUMBER_NOTE, unconfirmedMatchLabel } from '../../isometric-art/index.ts';

/** How each printed label is introduced (the text itself is shown exactly as printed). */
export const ARTWORK_LABEL_ROLES: Record<ArtworkLabelView['role'], string> = {
  display: 'Caption',
  'visible-block': 'Block heading',
  other: 'Also printed as',
  category: 'Index section',
};

export const NO_OFFICIAL_IDENTITY =
  'None recorded. Captions and numbers on the illustration are not official LPU names or block numbers.';

/** The artwork contract's ARTWORK_NUMBER_NOTE (from the zod-free text module). */
export const ARTWORK_NUMBER_NOTE_TEXT = ARTWORK_NUMBER_NOTE;

export const EVIDENCE_KIND_LABELS: Record<AssociationEvidence['kind'], string> = {
  'site-sign': 'Sign on site',
  'official-document': 'Official document',
  'owner-statement': 'Owner statement',
};

/**
 * Switches to the illustrated overview (the renderer's variant state,
 * src/app/isometric-variant.ts) and frames the current selection there.
 */
export function showOnIllustration(): void {
  setRequestedIsometricVariant('illustrated');
  const s = useAppStore.getState();
  s.setViewMode('isometric', { reason: 'user' });
  // Crossing between a map and the overview drops pending focus requests: ask again.
  if (s.selectedPlaceId) s.requestFocus({ kind: 'place', placeId: s.selectedPlaceId });
}

/** True while the illustrated overview is what the isometric mode shows. */
export function useOnIllustration(): boolean {
  const { artwork } = useAtlas();
  const requested = useRequestedIsometricVariant();
  const iso = useAppStore((s) => s.viewMode === 'isometric');
  return iso && (requested ?? 'illustrated') === 'illustrated' && artwork.unavailableReason === null;
}

/**
 * Frames an approximate item's candidate building on a map mode WITHOUT
 * selecting it (the match is unconfirmed: never this item's identity or route).
 */
export function frameCandidate(e: DirectoryEntry): void {
  const s = useAppStore.getState();
  if (s.viewMode === 'isometric' && s.mapUnavailable === null)
    s.setViewMode(s.lastMapMode, { reason: 'user' });
  s.showUnconfirmedMatch(e.id, unconfirmedMatchLabel(e.title));
}
