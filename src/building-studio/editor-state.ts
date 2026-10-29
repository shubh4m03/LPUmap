/**
 * Framework-agnostic Building Studio editor state (S9, S10, S13): a pure
 * reducer the admin UI wraps in a Zustand store. No React, DOM or network
 * here: server calls happen outside and report back with 'server/start',
 * 'server/success' and 'server/failure'.
 *
 * What it tracks:
 *  - the active tool and the selected building (public id);
 *  - a placement preview (template variant + translucent model) before the
 *    owner confirms a new building;
 *  - the server head of the record being edited (null = local only, not yet
 *    created on the server) and the local draft with its undo/redo stack;
 *  - whether a handle drag is in progress (map pan/rotate and selection are
 *    suppressed while true, S13);
 *  - one pending server operation, the last error (the local draft is
 *    always kept, so a failed save or publish can be retried) and the last
 *    409 conflict head;
 *  - the latest validation result and the draft marker it belongs to.
 *
 * Status (S10) is derived by `editorStatus`: unsaved local changes · saved
 * draft (rev n) · published (version n) · archived.
 */
import type { LngLat } from '../data/index.ts';
import { jsonEqual } from './canonical.ts';
import {
  applyEdit,
  beginGesture,
  cancelGesture,
  currentMarker,
  endGesture,
  initHistory,
  isDirty,
  markSaved,
  redo,
  sealField,
  undo,
  type HistoryState,
} from './history.ts';
import type {
  ModelConfigV1,
  StudioBuildingHead,
  StudioDraft,
  StudioIdentity,
  TemplateRef,
  ValidationResult,
} from './schema.ts';

export const STUDIO_TOOLS = ['select', 'add', 'move', 'rotate', 'resize', 'appearance', 'info'] as const;
export type StudioTool = (typeof STUDIO_TOOLS)[number];

export type ServerOp =
  | 'load'
  | 'create'
  | 'save-draft'
  | 'discard-draft'
  | 'validate'
  | 'publish'
  | 'archive'
  | 'restore'
  | 'delete'
  | 'duplicate'
  | 'apply-template';

export interface PlacementPreview {
  templateRef: TemplateRef;
  /** The translucent preview model (anchored in metres; moved by the map reticle or typed coordinates). */
  model: ModelConfigV1;
  /** Base building the new model belongs to, or null for a new building. */
  targetId: string | null;
}

export interface EditorError {
  op: ServerOp | 'edit';
  code: string;
  message: string;
  /** The local draft is kept; the same operation may be retried. */
  retryable: boolean;
}

export interface EditorState {
  tool: StudioTool;
  /** Public id of the selected building (targetId ?? id), or null. */
  selectedId: string | null;
  placement: PlacementPreview | null;
  /** Server head of the open record; null while the draft exists only locally. */
  head: StudioBuildingHead | null;
  /** Base building of the open record (or of the local draft), or null. */
  targetId: string | null;
  history: HistoryState<StudioDraft> | null;
  /** A handle drag is in progress (S13). */
  dragging: boolean;
  pending: { op: ServerOp; marker: number | null } | null;
  lastError: EditorError | null;
  /** Head returned with the last 409 conflict (reload and merge before retrying). */
  conflict: StudioBuildingHead | null;
  validation: { result: ValidationResult; marker: number } | null;
}

export const initialEditorState: EditorState = {
  tool: 'select',
  selectedId: null,
  placement: null,
  head: null,
  targetId: null,
  history: null,
  dragging: false,
  pending: null,
  lastError: null,
  conflict: null,
  validation: null,
};

export type EditorAction =
  | { type: 'tool'; tool: StudioTool }
  | { type: 'select'; id: string | null }
  | { type: 'placement/start'; templateRef: TemplateRef; model: ModelConfigV1; targetId?: string | null }
  | { type: 'placement/move'; anchor: LngLat }
  | { type: 'placement/update'; model: ModelConfigV1 }
  | { type: 'placement/confirm'; identity: StudioIdentity | null }
  | { type: 'placement/cancel' }
  | { type: 'record/load'; head: StudioBuildingHead; draft: StudioDraft }
  | { type: 'edit'; draft: StudioDraft; label: string; coalesceKey?: string | null }
  | { type: 'gesture/begin'; label: string }
  | { type: 'gesture/end' }
  | { type: 'gesture/cancel' }
  | { type: 'field/blur' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'server/start'; op: ServerOp }
  | {
      type: 'server/success';
      op: ServerOp;
      /** The head after the operation (absent for 'validate' and 'delete'). */
      head?: StudioBuildingHead;
      /** The record now shown (the server draft, else the published record), when the operation returns one. */
      draft?: StudioDraft | null;
      validation?: ValidationResult;
    }
  | {
      type: 'server/failure';
      op: ServerOp;
      code: string;
      message: string;
      /** 409 conflict: the current head (studioErrorDetailsSchema.current). */
      current?: StudioBuildingHead;
    }
  | { type: 'error/dismiss' }
  | { type: 'exit' };

const RETRYABLE = new Set(['network', 'unavailable', 'internal', 'rate-limited', 'timeout']);

const archived = (s: EditorState) => s.head?.status === 'archived';

function withHistory(s: EditorState, h: HistoryState<StudioDraft>): EditorState {
  return h === s.history ? s : { ...s, history: h };
}

function blocked(s: EditorState, message: string): EditorState {
  return { ...s, lastError: { op: 'edit', code: 'invalid-transition', message, retryable: false } };
}

/** The pure reducer. Unknown or impossible actions return the same state object. */
export function editorReducer(s: EditorState, a: EditorAction): EditorState {
  switch (a.type) {
    case 'tool':
      return s.dragging ? s : { ...s, tool: a.tool };
    case 'select':
      return s.dragging ? s : { ...s, selectedId: a.id };
    case 'placement/start':
      if (s.history && isDirty(s.history))
        return blocked(s, 'Save or discard the open changes before placing a new building.');
      return {
        ...s,
        tool: 'add',
        placement: { templateRef: a.templateRef, model: a.model, targetId: a.targetId ?? null },
      };
    case 'placement/move':
      return s.placement
        ? { ...s, placement: { ...s.placement, model: { ...s.placement.model, anchor: a.anchor } } }
        : s;
    case 'placement/update':
      return s.placement ? { ...s, placement: { ...s.placement, model: a.model } } : s;
    case 'placement/confirm': {
      if (!s.placement) return s;
      const draft: StudioDraft = {
        identity: a.identity,
        model: s.placement.model,
        verification: { status: 'unverified' },
        accessNodeId: null,
        templateRef: s.placement.templateRef,
        positionCorrection: null,
      };
      return {
        ...initialEditorState,
        tool: 'move',
        targetId: s.placement.targetId,
        history: initHistory(draft, { saved: false }),
      };
    }
    case 'placement/cancel':
      return s.placement ? { ...s, placement: null, tool: 'select' } : s;
    case 'record/load':
      return {
        ...initialEditorState,
        tool: 'select',
        selectedId: a.head.targetId ?? a.head.id,
        head: a.head,
        targetId: a.head.targetId,
        history: initHistory(a.draft, { saved: true }),
      };
    case 'edit':
      if (!s.history) return s;
      if (archived(s)) return blocked(s, 'This building is archived. Restore it before editing.');
      return withHistory(
        s,
        applyEdit(s.history, a.draft, { label: a.label, coalesceKey: a.coalesceKey ?? null }),
      );
    case 'gesture/begin':
      if (!s.history || archived(s)) return s;
      return { ...s, dragging: true, history: beginGesture(s.history, a.label) };
    case 'gesture/end':
      if (!s.history) return s.dragging ? { ...s, dragging: false } : s;
      return { ...s, dragging: false, history: endGesture(s.history) };
    case 'gesture/cancel':
      if (!s.history) return s.dragging ? { ...s, dragging: false } : s;
      return { ...s, dragging: false, history: cancelGesture(s.history) };
    case 'field/blur':
      return s.history ? withHistory(s, sealField(s.history)) : s;
    case 'undo':
      return s.history && !s.dragging ? withHistory(s, undo(s.history)) : s;
    case 'redo':
      return s.history && !s.dragging ? withHistory(s, redo(s.history)) : s;
    case 'server/start': {
      if (s.pending) return s; // one server operation at a time
      // The open field command is closed, so typing during the request starts a new command and
      // the marker of the state sent stays on the stack (merging would replace it).
      const history = s.history ? sealField(s.history) : null;
      return {
        ...s,
        history,
        pending: { op: a.op, marker: history ? currentMarker(history) : null },
        lastError: null,
      };
    }
    case 'server/success':
      return serverSuccess(s, a);
    case 'server/failure':
      if (!s.pending || s.pending.op !== a.op) return s;
      return {
        ...s,
        pending: null,
        lastError: {
          op: a.op,
          code: a.code,
          message: a.message,
          retryable: RETRYABLE.has(a.code) || a.code === 'conflict',
        },
        conflict: a.code === 'conflict' && a.current ? a.current : s.conflict,
      };
    case 'error/dismiss':
      return s.lastError || s.conflict ? { ...s, lastError: null, conflict: null } : s;
    case 'exit':
      return initialEditorState;
  }
}

function serverSuccess(s: EditorState, a: Extract<EditorAction, { type: 'server/success' }>): EditorState {
  if (!s.pending || s.pending.op !== a.op) return s;
  const marker = s.pending.marker;
  const base: EditorState = { ...s, pending: null, lastError: null, conflict: null };
  switch (a.op) {
    case 'validate':
      return a.validation && marker !== null
        ? { ...base, validation: { result: a.validation, marker } }
        : base;
    case 'delete':
      return { ...initialEditorState };
    case 'duplicate':
    case 'load':
      // A different (or freshly loaded) record becomes the open one.
      return a.head && a.draft
        ? editorReducer({ ...base }, { type: 'record/load', head: a.head, draft: a.draft })
        : base;
    default: {
      const head = a.head ?? s.head;
      let history = s.history;
      if (history && a.draft !== undefined && a.draft !== null) {
        // What the server now holds. Same as the local state at the start → mark that state saved
        // (later edits stay dirty); otherwise the server's version replaces the local one.
        // Local edits made during the request are never replaced: if the state sent is gone
        // (undone and overwritten) or the server changed it, they stay as unsaved changes.
        const sent = marker !== null ? draftAt(history, marker) : null;
        if (marker !== null && sent !== null && jsonEqual(a.draft, sent))
          history = markSaved(history, marker);
        else if (marker !== null && marker !== currentMarker(history))
          history = { ...history, savedMarker: null };
        else history = initHistory(a.draft, { saved: true, maxDepth: history.maxDepth });
      } else if (history && marker !== null && (a.op === 'create' || a.op === 'save-draft')) {
        history = markSaved(history, marker);
      }
      return { ...base, head: head ?? null, targetId: head?.targetId ?? s.targetId, history };
    }
  }
}

/** The local draft at a marker still on the stack, or null. */
function draftAt(h: HistoryState<StudioDraft>, marker: number): StudioDraft | null {
  if (marker === currentMarker(h)) return h.present;
  const inPast = h.past.find((e) => e.id === marker);
  if (inPast) return inPast.after;
  const inFuture = h.future.find((e) => e.id === marker);
  if (inFuture) return inFuture.after;
  return marker === h.baseMarker ? (h.past[0]?.before ?? h.future[0]?.before ?? null) : null;
}

// ---------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------

export type StatusKind = 'none' | 'unsaved' | 'saved-draft' | 'published' | 'archived';

export interface EditorStatus {
  kind: StatusKind;
  /** Always-visible label (S10). */
  label: string;
  /** What the server holds underneath unsaved changes, or null. */
  serverLabel: string | null;
  dirty: boolean;
}

function serverLabel(head: StudioBuildingHead): string {
  if (head.status === 'archived') return 'Archived';
  if (head.hasDraft) return `Saved draft (rev ${head.draftRevision})`;
  return head.publishedVersion !== null ? `Published (version ${head.publishedVersion})` : 'Saved draft';
}

function serverKind(head: StudioBuildingHead): StatusKind {
  if (head.status === 'archived') return 'archived';
  return head.hasDraft ? 'saved-draft' : 'published';
}

export function editorStatus(s: EditorState): EditorStatus {
  if (!s.history) return { kind: 'none', label: 'Nothing open', serverLabel: null, dirty: false };
  const dirty = isDirty(s.history);
  if (!s.head)
    return {
      kind: 'unsaved',
      label: 'Unsaved local changes (not on the server yet)',
      serverLabel: null,
      dirty: true,
    };
  const server = serverLabel(s.head);
  if (dirty) return { kind: 'unsaved', label: 'Unsaved local changes', serverLabel: server, dirty };
  const published =
    s.head.hasDraft && s.head.publishedVersion !== null
      ? `Published (version ${s.head.publishedVersion})`
      : null;
  return { kind: serverKind(s.head), label: server, serverLabel: published, dirty };
}

/** The `beforeunload` guard is active while local changes are unsaved (S10). */
export const shouldGuardUnload = (s: EditorState): boolean => s.history !== null && isDirty(s.history);

/** Map pan/rotate and map selection are suppressed while a handle is dragged (S13). */
export const mapInteractionsEnabled = (s: EditorState): boolean => !s.dragging;

export type PublishBlocker =
  | 'nothing-open'
  | 'not-on-server'
  | 'unsaved-changes'
  | 'no-draft'
  | 'archived'
  | 'pending'
  | 'not-validated'
  | 'validation-errors';

/** Why "Publish" is not offered yet (empty = it can be offered; the server re-validates anyway). */
export function publishBlockers(s: EditorState): PublishBlocker[] {
  if (!s.history) return ['nothing-open'];
  const out: PublishBlocker[] = [];
  if (!s.head) out.push('not-on-server');
  if (isDirty(s.history)) out.push('unsaved-changes');
  if (s.head && !s.head.hasDraft) out.push('no-draft');
  if (archived(s)) out.push('archived');
  if (s.pending) out.push('pending');
  if (!s.validation || s.validation.marker !== currentMarker(s.history)) out.push('not-validated');
  else if (s.validation.result.errorCount > 0) out.push('validation-errors');
  return out;
}

/** The local draft being edited, or null. */
export const currentDraft = (s: EditorState): StudioDraft | null => s.history?.present ?? null;
