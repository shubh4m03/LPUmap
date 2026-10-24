/**
 * State of the "Suggest a missing place" flow (memory only: a draft is never
 * written to storage). The panel shows it; MapStage reads the point and the
 * step to put the map into placement mode (src/components/suggest/
 * useSuggestEditing.ts).
 *
 *   place ──(point chosen)──▶ details ──submit──▶ submitted
 *     ▲                          │
 *     └──────── change point ────┘
 */
import { create } from 'zustand';
import type { LngLat } from '../../data/schema.ts';
import { EMPTY_SUGGEST_FORM, type SuggestErrors, type SuggestFormValues } from './suggest-model.ts';
import type { SubmitOutcome } from './submit.ts';

export type SuggestStep = 'place' | 'details' | 'submitted';

export interface SuggestState {
  step: SuggestStep;
  point: LngLat | null;
  /** Map centre reported by the mobile centre pin. */
  reticleCenter: LngLat | null;
  values: SuggestFormValues;
  errors: SuggestErrors;
  submitting: boolean;
  /** The last answer (a failure stays on the details step; success moves to `submitted`). */
  outcome: SubmitOutcome | null;
  setPoint(p: LngLat): void;
  setReticleCenter(p: LngLat): void;
  setStep(step: SuggestStep): void;
  setValues(patch: Partial<SuggestFormValues>): void;
  setErrors(errors: SuggestErrors): void;
  setSubmitting(on: boolean): void;
  setOutcome(o: SubmitOutcome | null): void;
  /** Starts over (after a submission, or "Suggest another"). */
  reset(): void;
}

const initial = {
  step: 'place' as SuggestStep,
  point: null,
  reticleCenter: null,
  values: EMPTY_SUGGEST_FORM,
  errors: {},
  submitting: false,
  outcome: null,
};

export const useSuggestStore = create<SuggestState>()((set) => ({
  ...initial,
  setPoint: (point) => set((s) => ({ point, errors: { ...s.errors, location: undefined } })),
  setReticleCenter: (reticleCenter) => set({ reticleCenter }),
  setStep: (step) => set({ step }),
  setValues: (patch) => set((s) => ({ values: { ...s.values, ...patch } })),
  setErrors: (errors) => set({ errors }),
  setSubmitting: (submitting) => set({ submitting }),
  setOutcome: (outcome) => set({ outcome }),
  reset: () => set({ ...initial }),
}));
