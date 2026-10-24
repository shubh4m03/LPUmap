/**
 * Command stack (S9): drag = one command, field-focus coalescing, depth
 * limit, and save markers (undo after save → unsaved changes).
 */
import { describe, expect, it } from 'vitest';
import {
  applyEdit,
  beginGesture,
  canRedo,
  canUndo,
  cancelGesture,
  currentMarker,
  endGesture,
  initHistory,
  isDirty,
  markSaved,
  nextLabels,
  redo,
  sealField,
  undo,
  type HistoryState,
} from '../../../src/building-studio/history.ts';

type S = { x: number; name: string };
const s0: S = { x: 0, name: '' };
const edit = (h: HistoryState<S>, patch: Partial<S>, label = 'edit', coalesceKey?: string) =>
  applyEdit(h, { ...h.present, ...patch }, { label, coalesceKey });

describe('basic undo/redo', () => {
  it('records effective edits only and undoes/redoes them in order', () => {
    let h = initHistory(s0, { saved: true });
    h = edit(h, { x: 0 }); // no change → nothing recorded
    expect(canUndo(h)).toBe(false);
    h = edit(h, { x: 1 }, 'move');
    h = edit(h, { x: 2 }, 'move again');
    expect(nextLabels(h)).toEqual({ undo: 'move again', redo: null });
    h = undo(h);
    expect(h.present.x).toBe(1);
    h = undo(h);
    expect(h.present.x).toBe(0);
    expect(undo(h)).toBe(h); // nothing left
    h = redo(h);
    expect(h.present.x).toBe(1);
    expect(nextLabels(h)).toEqual({ undo: 'move', redo: 'move again' });
    h = edit(h, { x: 5 });
    expect(canRedo(h)).toBe(false); // a new edit clears redo
  });

  it('never mutates earlier states', () => {
    const h0 = initHistory(s0);
    const h1 = edit(h0, { x: 1 });
    expect(h0.present).toEqual(s0);
    expect(h0.past).toEqual([]);
    expect(h1.past).toHaveLength(1);
  });
});

describe('gestures: a drag is one command', () => {
  it('previews during the drag and records one command on release', () => {
    let h = initHistory(s0, { saved: true });
    h = beginGesture(h, 'Drag');
    for (let i = 1; i <= 30; i++) h = edit(h, { x: i });
    expect(h.present.x).toBe(30);
    expect(h.past).toHaveLength(0);
    expect(isDirty(h)).toBe(true);
    expect(canUndo(h)).toBe(false); // no undo mid-drag
    h = endGesture(h);
    expect(h.past).toHaveLength(1);
    expect(h.past[0]).toMatchObject({ label: 'Drag', before: s0, after: { x: 30, name: '' } });
    h = undo(h);
    expect(h.present).toEqual(s0);
    expect(isDirty(h)).toBe(false);
  });

  it('a drag that ends where it started records nothing; cancel restores the start', () => {
    let h = initHistory(s0, { saved: true });
    h = beginGesture(h, 'Drag');
    h = edit(h, { x: 4 });
    h = edit(h, { x: 0 });
    h = endGesture(h);
    expect(h.past).toHaveLength(0);
    h = beginGesture(h, 'Drag');
    h = edit(h, { x: 9 });
    h = cancelGesture(h);
    expect(h.present).toEqual(s0);
    expect(h.past).toHaveLength(0);
    expect(isDirty(h)).toBe(false);
    expect(endGesture(h)).toBe(h);
  });
});

describe('field-focus coalescing', () => {
  it('typing in one field is one command until blur; another field starts a new one', () => {
    let h = initHistory(s0, { saved: true });
    for (const name of ['B', 'Bl', 'Blo', 'Bloc', 'Block']) h = edit(h, { name }, 'Name', 'identity.name');
    expect(h.past).toHaveLength(1);
    expect(h.past[0]!.after.name).toBe('Block');
    h = edit(h, { x: 3 }, 'Width', 'model.widthM');
    expect(h.past).toHaveLength(2);
    h = edit(h, { x: 4 }, 'Width', 'model.widthM');
    expect(h.past).toHaveLength(2);
    h = sealField(h);
    h = edit(h, { x: 5 }, 'Width', 'model.widthM');
    expect(h.past).toHaveLength(3); // after blur, the same field starts a new command
    h = undo(h);
    expect(h.present.x).toBe(4);
    h = undo(h);
    expect(h.present).toEqual({ x: 0, name: 'Block' });
  });

  it('typing a value back to the original removes the command', () => {
    let h = initHistory(s0, { saved: true });
    h = edit(h, { name: 'A' }, 'Name', 'identity.name');
    h = edit(h, { name: '' }, 'Name', 'identity.name');
    expect(h.past).toHaveLength(0);
    expect(isDirty(h)).toBe(false);
  });
});

describe('depth limit', () => {
  it('keeps the newest maxDepth commands', () => {
    let h = initHistory(s0, { maxDepth: 3 });
    for (let i = 1; i <= 5; i++) h = edit(h, { x: i });
    expect(h.past.map((e) => e.after.x)).toEqual([3, 4, 5]);
    h = undo(undo(undo(h)));
    expect(h.present.x).toBe(2);
    expect(canUndo(h)).toBe(false);
  });
});

describe('save markers (S9: undo never undoes a server save)', () => {
  it('a new local draft is dirty until saved', () => {
    const h = initHistory(s0);
    expect(h.savedMarker).toBeNull();
    expect(isDirty(h)).toBe(true);
    expect(isDirty(markSaved(h))).toBe(false);
  });

  it('undo after a save makes the draft dirty; redo back to the saved state makes it clean', () => {
    let h = initHistory(s0, { saved: true });
    h = edit(h, { x: 1 });
    h = edit(h, { x: 2 });
    h = markSaved(h);
    expect(isDirty(h)).toBe(false);
    h = undo(h);
    expect(h.present.x).toBe(1);
    expect(isDirty(h)).toBe(true); // "unsaved changes" — the server still holds x = 2
    h = redo(h);
    expect(isDirty(h)).toBe(false);
  });

  it('edits made while a save is in flight stay dirty after it succeeds', () => {
    let h = initHistory(s0, { saved: true });
    h = edit(h, { name: 'Hall' }, 'Name', 'identity.name');
    const marker = currentMarker(h); // the save request carries this state
    h = edit(h, { name: 'Hall 2' }, 'Name', 'identity.name'); // merged into the same command
    h = markSaved(h, marker);
    expect(isDirty(h)).toBe(true);
  });

  it('a save closes the open command: later typing is a separate undo step', () => {
    let h = initHistory(s0, { saved: true });
    h = edit(h, { name: 'Ha' }, 'Name', 'identity.name');
    h = markSaved(h);
    h = edit(h, { name: 'Hall' }, 'Name', 'identity.name');
    expect(h.past).toHaveLength(2);
    h = undo(h);
    expect(h.present.name).toBe('Ha');
    expect(isDirty(h)).toBe(false);
  });
});
