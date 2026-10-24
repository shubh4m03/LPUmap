/**
 * The Building Studio UI store (Zustand): the pure editor reducer
 * (../editor-state.ts, with its undo/redo history ../history.ts) plus the UI
 * state around it — the server validation of a specific draft, warning
 * acknowledgements, a snapping proposal, crash-recovery offers and notices.
 *
 * Server calls live in ./actions.ts; this file holds no I/O.
 *
 * Validation is kept with the exact draft it was computed for: it counts as
 * current only while the open draft is equal (canonical JSON) to that draft,
 * whatever happened to the history markers in between.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { jsonEqual } from '../canonical.ts';
import {
  currentDraft,
  editorReducer,
  editorStatus,
  initialEditorState,
  publishBlockers,
  shouldGuardUnload,
  type EditorAction,
  type EditorState,
  type EditorStatus,
  type PublishBlocker,
} from '../editor-state.ts';
import { canRedo, canUndo, currentMarker, initHistory, nextLabels } from '../history.ts';
import type { RecoveryEntry } from '../local-recovery.ts';
import type { SnapProposal } from '../geometry.ts';
import { placementDraft } from './fields.ts';
import type {
  StudioBuildingDetail,
  StudioBuildingHead,
  StudioDraft,
  ValidationResult,
  WarningCode,
} from '../schema.ts';

export interface StudioValidation {
  result: ValidationResult;
  /** The draft that was validated (content-compared with the open draft). */
  draft: StudioDraft;
  targetId: string | null;
}

export type StudioNotice = { tone: 'success' | 'info' | 'warning' | 'danger'; message: string };

export type OkProposal = Extract<SnapProposal, { ok: true }>;

export interface StudioUiState {
  editor: EditorState;
  /** Server detail of the open record as last loaded or written (published record for the change list). */
  detail: StudioBuildingDetail | null;
  /** The draft the open record had on the server when loaded / last saved ("before" of before/after). */
  baseline: StudioDraft | null;
  validation: StudioValidation | null;
  validating: boolean;
  validationError: string | null;
  /** Reason per acknowledged warning code (kept while the record stays open). */
  acknowledgements: Partial<Record<WarningCode, string>>;
  proposal: OkProposal | null;
  /** Explanation of the last proposal request that produced nothing. */
  proposalNote: string | null;
  /** Floors / floor height edits also set the body height (explicit option). */
  linkHeight: boolean;
  /** Crash-recovery entry offered for the open record (or for a new building). */
  recovery: RecoveryEntry | null;
  notice: StudioNotice | null;
  /** Category a placed new building starts with (the template's suggestion). */
  placementCategoryId: string;
  /** Inspector view. */
  inspectorTab: 'properties' | 'checks';
}

export const initialStudioUiState: StudioUiState = {
  editor: initialEditorState,
  detail: null,
  baseline: null,
  validation: null,
  validating: false,
  validationError: null,
  acknowledgements: {},
  proposal: null,
  proposalNote: null,
  linkHeight: false,
  recovery: null,
  notice: null,
  placementCategoryId: 'building',
  inspectorTab: 'properties',
};

export interface StudioStore extends StoreApi<StudioUiState> {
  dispatch(action: EditorAction): void;
}

export function createStudioStore(initial: Partial<StudioUiState> = {}): StudioStore {
  const store = createStore<StudioUiState>()(() => ({ ...initialStudioUiState, ...initial }));
  const dispatch = (action: EditorAction) => {
    const s = store.getState();
    const editor = editorReducer(s.editor, action);
    if (editor === s.editor) return;
    const patch: Partial<StudioUiState> = { editor };
    // A different record (or none) is open now: per-record UI state does not carry over.
    const prevId = s.editor.head?.id ?? null;
    const nextId = editor.head?.id ?? null;
    if (action.type === 'exit' || action.type === 'record/load' || (prevId !== null && prevId !== nextId)) {
      patch.acknowledgements = {};
      patch.proposal = null;
      patch.proposalNote = null;
      patch.recovery = null;
      if (action.type === 'exit') {
        patch.detail = null;
        patch.baseline = null;
        patch.validation = null;
        patch.validationError = null;
      }
    }
    // Any edit invalidates a shown proposal (it was computed from the previous model).
    if (s.proposal && currentDraft(editor)?.model !== currentDraft(s.editor)?.model) patch.proposal = null;
    store.setState(patch);
  };
  return Object.assign(store, { dispatch });
}

/** React hook for one store. */
export function useStudio<T>(store: StudioStore, selector: (s: StudioUiState) => T): T {
  return useStore(store, selector);
}

// ---------------------------------------------------------------------------
// Pure helpers (direct state changes the reducer has no action for)
// ---------------------------------------------------------------------------

/** Opens a draft that exists only in this browser (crash recovery of a not-yet-created building). */
export function hydrateLocalDraft(
  s: StudioUiState,
  draft: StudioDraft,
  targetId: string | null,
): StudioUiState {
  return {
    ...s,
    editor: { ...initialEditorState, tool: 'move', targetId, history: initHistory(draft, { saved: false }) },
    baseline: null,
    detail: null,
    validation: null,
    recovery: null,
  };
}

/**
 * After a 409: keep the local changes and continue from the server's current
 * head (its revision), so the next save overwrites it. Only offered after the
 * draft has been re-validated against the current server data.
 */
export function adoptConflictHead(s: StudioUiState, head: StudioBuildingHead): StudioUiState {
  return {
    ...s,
    editor: {
      ...s.editor,
      head,
      conflict: null,
      lastError: null,
      history: s.editor.history ? { ...s.editor.history, savedMarker: null } : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const selectDraft = (s: StudioUiState): StudioDraft | null => currentDraft(s.editor);

/** What the server check is about: the open draft, or the draft a placement preview would create. */
export function checkTarget(s: StudioUiState): { draft: StudioDraft; targetId: string | null } | null {
  const draft = currentDraft(s.editor);
  if (draft) return { draft, targetId: s.editor.targetId };
  const p = s.editor.placement;
  return p ? { draft: placementDraft(p, s.placementCategoryId), targetId: p.targetId } : null;
}

/** The validation of exactly the open (or previewed) draft; null when stale or absent. */
export function currentValidation(s: StudioUiState): ValidationResult | null {
  const t = checkTarget(s);
  if (!t || !s.validation) return null;
  if (s.validation.targetId !== t.targetId) return null;
  return jsonEqual(s.validation.draft, t.draft) ? s.validation.result : null;
}

/** Why Publish is not offered (the reducer's rules with the content-checked validation). */
export function studioPublishBlockers(s: StudioUiState): PublishBlocker[] {
  const result = currentValidation(s);
  const editor: EditorState = {
    ...s.editor,
    validation: result && s.editor.history ? { result, marker: currentMarker(s.editor.history) } : null,
  };
  return publishBlockers(editor);
}

export const PUBLISH_BLOCKER_TEXT: Readonly<Record<PublishBlocker, string>> = {
  'nothing-open': 'Open or place a building first.',
  'not-on-server': 'Save the draft on the server first.',
  'unsaved-changes': 'Save your changes as a draft first.',
  'no-draft': 'There is no draft to publish: the published version is current.',
  archived: 'This building is archived. Restore it first.',
  pending: 'Wait for the current server request to finish.',
  'not-validated': 'Wait for the server check of this exact draft.',
  'validation-errors': 'Fix the errors listed under Checks first.',
};

/** Warning codes of the current validation that still have no acknowledgement reason. */
export function missingAcks(s: StudioUiState): WarningCode[] {
  const result = currentValidation(s);
  if (!result) return [];
  return result.requiredAcknowledgements.filter((c) => !validAckReason(s.acknowledgements[c]));
}

export const ACK_REASON_MIN = 5;
export const ACK_REASON_MAX = 300;
export const validAckReason = (r: string | undefined): r is string =>
  r !== undefined && r.trim().length >= ACK_REASON_MIN && r.trim().length <= ACK_REASON_MAX;

export interface StudioStatusView extends EditorStatus {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  guardUnload: boolean;
}

export function studioStatus(s: StudioUiState): StudioStatusView {
  const h = s.editor.history;
  const labels = h ? nextLabels(h) : { undo: null, redo: null };
  return {
    ...editorStatus(s.editor),
    canUndo: h ? canUndo(h) && !s.editor.dragging : false,
    canRedo: h ? canRedo(h) && !s.editor.dragging : false,
    undoLabel: labels.undo,
    redoLabel: labels.redo,
    guardUnload: shouldGuardUnload(s.editor),
  };
}
