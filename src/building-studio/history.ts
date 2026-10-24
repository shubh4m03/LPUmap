/**
 * Undo/redo command stack over the LOCAL draft (S9). Pure and immutable:
 * every function returns a new state; nothing here talks to the server.
 *
 * Semantics:
 *  - Every effective edit is one command { before, after }. An edit that
 *    leaves the value unchanged records nothing.
 *  - Gestures: between beginGesture and endGesture (a handle drag, pointer
 *    down → up) edits only preview; endGesture records ONE command from the
 *    value before the drag to the value at release. cancelGesture restores
 *    the value before the drag and records nothing.
 *  - Field focus: edits with the same `coalesceKey` (e.g. 'model.heightM')
 *    merge into the open command until the field loses focus (sealField),
 *    another key is edited, or undo/redo/markSaved happens. Typing a value
 *    back to where it started removes the command.
 *  - Depth: at most `maxDepth` commands are kept (the oldest are dropped).
 *  - Saving: markSaved(marker) records which local state the server holds.
 *    `dirty` compares markers, so undoing after a save makes the draft
 *    "unsaved changes" again (undo never claims to undo a server save), and
 *    redoing back to the saved state makes it clean. Every recorded or
 *    merged command gets a fresh marker, so a save that started before
 *    further typing never marks the newer text as saved.
 */
import { jsonEqual } from './canonical.ts';

export interface HistoryEntry<T> {
  /** Marker of the state after this command (unique, increasing). */
  id: number;
  label: string;
  before: T;
  after: T;
  coalesceKey: string | null;
  /** A sealed command never absorbs later edits. */
  sealed: boolean;
}

export interface HistoryState<T> {
  present: T;
  /** Oldest first. */
  past: readonly HistoryEntry<T>[];
  /** Next redo last. */
  future: readonly HistoryEntry<T>[];
  /** Marker of the state before the oldest kept command. */
  baseMarker: number;
  nextId: number;
  /** Marker of the state the server holds, or null when nothing is saved yet. */
  savedMarker: number | null;
  gesture: { label: string; before: T } | null;
  maxDepth: number;
}

export const DEFAULT_HISTORY_DEPTH = 100;

export interface EditOptions {
  label: string;
  /** Edits with the same key merge into one command while the field keeps focus. */
  coalesceKey?: string | null;
}

/** A fresh stack. `saved: true` when `present` is what the server holds (a loaded record). */
export function initHistory<T>(
  present: T,
  opts: { saved?: boolean; maxDepth?: number } = {},
): HistoryState<T> {
  return {
    present,
    past: [],
    future: [],
    baseMarker: 0,
    nextId: 1,
    savedMarker: opts.saved ? 0 : null,
    gesture: null,
    maxDepth: Math.max(1, opts.maxDepth ?? DEFAULT_HISTORY_DEPTH),
  };
}

/** Marker of the current state. */
export const currentMarker = <T>(h: HistoryState<T>): number => h.past.at(-1)?.id ?? h.baseMarker;

/** Unsaved local changes: the present is not the saved state, or a gesture is in progress. */
export const isDirty = <T>(h: HistoryState<T>): boolean =>
  h.gesture !== null || h.savedMarker !== currentMarker(h);

export const canUndo = <T>(h: HistoryState<T>): boolean => h.gesture === null && h.past.length > 0;
export const canRedo = <T>(h: HistoryState<T>): boolean => h.gesture === null && h.future.length > 0;

const sealTop = <T>(past: readonly HistoryEntry<T>[]): HistoryEntry<T>[] => {
  const top = past.at(-1);
  return top && !top.sealed ? [...past.slice(0, -1), { ...top, sealed: true }] : [...past];
};

function trim<T>(h: HistoryState<T>, past: HistoryEntry<T>[]): Pick<HistoryState<T>, 'past' | 'baseMarker'> {
  let baseMarker = h.baseMarker;
  while (past.length > h.maxDepth) baseMarker = past.shift()!.id;
  return { past, baseMarker };
}

/** Applies an edit (a preview while a gesture is active). */
export function applyEdit<T>(h: HistoryState<T>, next: T, opts: EditOptions): HistoryState<T> {
  if (h.gesture) return { ...h, present: next };
  if (jsonEqual(h.present, next)) return h;
  const key = opts.coalesceKey ?? null;
  const top = h.past.at(-1);
  if (key !== null && top && !top.sealed && top.coalesceKey === key) {
    const rest = h.past.slice(0, -1);
    if (jsonEqual(top.before, next))
      return { ...h, present: next, past: rest, future: [], baseMarker: h.baseMarker };
    return {
      ...h,
      present: next,
      past: [...rest, { ...top, after: next, id: h.nextId }],
      future: [],
      nextId: h.nextId + 1,
    };
  }
  const entry: HistoryEntry<T> = {
    id: h.nextId,
    label: opts.label,
    before: h.present,
    after: next,
    coalesceKey: key,
    sealed: key === null,
  };
  return { ...h, present: next, ...trim(h, [...sealTop(h.past), entry]), future: [], nextId: h.nextId + 1 };
}

/** Field lost focus: its open command is closed. */
export const sealField = <T>(h: HistoryState<T>): HistoryState<T> =>
  h.past.at(-1)?.sealed === false ? { ...h, past: sealTop(h.past) } : h;

/** Starts a gesture (pointer down on a handle). A gesture already in progress is kept. */
export function beginGesture<T>(h: HistoryState<T>, label: string): HistoryState<T> {
  if (h.gesture) return h;
  return { ...h, past: sealTop(h.past), gesture: { label, before: h.present } };
}

/** Ends a gesture (pointer up): one command for the whole drag, or nothing if nothing moved. */
export function endGesture<T>(h: HistoryState<T>): HistoryState<T> {
  if (!h.gesture) return h;
  const { before, label } = h.gesture;
  const settled: HistoryState<T> = { ...h, gesture: null, present: before };
  return applyEdit(settled, h.present, { label });
}

/** Cancels a gesture (Escape, pointer cancel, exit): the value before the drag comes back. */
export const cancelGesture = <T>(h: HistoryState<T>): HistoryState<T> =>
  h.gesture ? { ...h, present: h.gesture.before, gesture: null } : h;

export function undo<T>(h: HistoryState<T>): HistoryState<T> {
  if (!canUndo(h)) return h;
  const past = sealTop(h.past);
  const entry = past.pop()!;
  return { ...h, present: entry.before, past, future: [...h.future, entry] };
}

export function redo<T>(h: HistoryState<T>): HistoryState<T> {
  if (!canRedo(h)) return h;
  const future = [...h.future];
  const entry = future.pop()!;
  return { ...h, present: entry.after, past: [...sealTop(h.past), entry], future };
}

/**
 * Records that the server now holds the state with `marker` (default: the
 * current one). The open command is closed when that is the current state,
 * so edits after a save start a new command.
 */
export function markSaved<T>(h: HistoryState<T>, marker: number = currentMarker(h)): HistoryState<T> {
  const current = marker === currentMarker(h);
  return { ...h, savedMarker: marker, past: current ? sealTop(h.past) : [...h.past] };
}

/** Labels of the next undo and redo commands, for button titles. */
export function nextLabels<T>(h: HistoryState<T>): { undo: string | null; redo: string | null } {
  return { undo: canUndo(h) ? h.past.at(-1)!.label : null, redo: canRedo(h) ? h.future.at(-1)!.label : null };
}
