import { create } from 'zustand';
import { z } from 'zod';
import { createStorage } from '../utils/storage.ts';
import { registerLocalDataReset } from '../privacy/index.ts';
import { CORRECTION_KINDS, DETAILS_MAX, PLACE_ID_MAX, PLACE_NAME_MAX, SOURCE_URL_MAX } from './correction.ts';
import type { CorrectionKind } from './correction.ts';

/** An in-progress form: every field may be empty or incomplete. */
export interface CorrectionFormDraft {
  kind: CorrectionKind | '';
  placeId: string;
  placeName: string;
  details: string;
  sourceUrl: string;
}

export const EMPTY_DRAFT: CorrectionFormDraft = {
  kind: '',
  placeId: '',
  placeName: '',
  details: '',
  sourceUrl: '',
};

const formDraftSchema = z.object({
  kind: z.union([z.enum(CORRECTION_KINDS), z.literal('')]),
  placeId: z.string().max(PLACE_ID_MAX * 2),
  placeName: z.string().max(PLACE_NAME_MAX * 2),
  // Slack beyond the submit limits so over-long text is kept for the user to trim.
  details: z.string().max(DETAILS_MAX * 2),
  sourceUrl: z.string().max(SOURCE_URL_MAX * 2),
});

/** Session storage only: survives a reload, not the end of the browser session. */
export const draftStorage = createStorage('correction-draft', formDraftSchema, EMPTY_DRAFT, {
  area: 'session',
});

export interface CorrectionDraftState {
  draft: CorrectionFormDraft;
  update(patch: Partial<CorrectionFormDraft>): void;
  reset(): void;
}

export const useCorrectionDraft = create<CorrectionDraftState>()((set, get) => ({
  draft: draftStorage.get(),
  update(patch) {
    const draft = { ...get().draft, ...patch };
    set({ draft });
    const persisted = formDraftSchema.safeParse(draft).success && draftStorage.set(draft);
    // Keep an over-long draft in memory only, and never leave an older copy behind.
    if (!persisted) draftStorage.clear();
  },
  reset() {
    set({ draft: EMPTY_DRAFT });
    draftStorage.clear();
  },
}));

registerLocalDataReset(() => useCorrectionDraft.setState({ draft: EMPTY_DRAFT }));
