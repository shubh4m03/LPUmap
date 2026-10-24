/**
 * Editor state machine (S9, S10, S13): placement → local draft → saved
 * draft → published → archived, visible status labels, the unload guard,
 * drag suppression, one pending server operation, failure-safe retries.
 */
import { describe, expect, it } from 'vitest';
import {
  currentDraft,
  editorReducer,
  editorStatus,
  initialEditorState,
  mapInteractionsEnabled,
  publishBlockers,
  shouldGuardUnload,
  type EditorAction,
  type EditorState,
} from '../../../src/building-studio/editor-state.ts';
import type {
  StudioBuildingHead,
  StudioDraft,
  ValidationResult,
} from '../../../src/building-studio/schema.ts';
import { ANCHOR, STU_ID, T, draft, identity, model } from './fixtures.ts';

const reduce = (s: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, s);
const head = (over: Partial<StudioBuildingHead> = {}): StudioBuildingHead => ({
  id: STU_ID,
  targetId: null,
  status: 'draft',
  revision: 1,
  draftRevision: 1,
  hasDraft: true,
  publishedVersion: null,
  archivedAt: null,
  archiveReason: null,
  createdBy: 'owner',
  createdAt: T,
  updatedBy: 'owner',
  updatedAt: T,
  ...over,
});
const clean: ValidationResult = {
  issues: [],
  errorCount: 0,
  warningCount: 0,
  publishable: true,
  requiredAcknowledgements: [],
};
const withName = (d: StudioDraft, name: string): StudioDraft => ({ ...d, identity: identity({ name }) });

function placed(): EditorState {
  return reduce(
    initialEditorState,
    {
      type: 'placement/start',
      templateRef: { templateId: 'academic-block', templateVersion: 1, variantId: 'plain' },
      model: model(),
    },
    { type: 'placement/move', anchor: [ANCHOR[0] + 0.001, ANCHOR[1]] },
    { type: 'placement/confirm', identity: identity() },
  );
}

describe('placement', () => {
  it('start → move the preview → confirm creates an unsaved local draft from the variant', () => {
    let s = reduce(initialEditorState, {
      type: 'placement/start',
      templateRef: { templateId: 'academic-block', templateVersion: 1, variantId: 'plain' },
      model: model(),
    });
    expect(s.tool).toBe('add');
    s = editorReducer(s, { type: 'placement/move', anchor: [75.7, 31.25] });
    expect(s.placement!.model.anchor).toEqual([75.7, 31.25]);
    s = editorReducer(s, { type: 'placement/confirm', identity: identity() });
    expect(s.placement).toBeNull();
    expect(currentDraft(s)).toMatchObject({
      verification: { status: 'unverified' },
      accessNodeId: null,
      positionCorrection: null,
      templateRef: { templateId: 'academic-block', variantId: 'plain' },
      model: { anchor: [75.7, 31.25] },
    });
    expect(editorStatus(s)).toMatchObject({
      kind: 'unsaved',
      label: 'Unsaved local changes (not on the server yet)',
    });
    expect(shouldGuardUnload(s)).toBe(true);
    expect(publishBlockers(s)).toContain('not-on-server');
  });

  it('cancel discards the preview; a new placement is refused while changes are unsaved', () => {
    const s = reduce(initialEditorState, {
      type: 'placement/start',
      templateRef: { templateId: 'academic-block', templateVersion: 1, variantId: 'plain' },
      model: model(),
    });
    expect(editorReducer(s, { type: 'placement/cancel' }).placement).toBeNull();
    const busy = editorReducer(placed(), {
      type: 'placement/start',
      templateRef: { templateId: 'library', templateVersion: 1, variantId: 'courtyard' },
      model: model(),
    });
    expect(busy.placement).toBeNull();
    expect(busy.lastError?.code).toBe('invalid-transition');
  });
});

describe('server round trips and the S10 status labels', () => {
  it('create → saved draft (rev 1) → edit → unsaved → save → saved draft (rev 2) → publish → published', () => {
    let s = placed();
    const d0 = currentDraft(s)!;
    s = reduce(
      s,
      { type: 'server/start', op: 'create' },
      { type: 'server/success', op: 'create', head: head() },
    );
    expect(editorStatus(s)).toMatchObject({
      kind: 'saved-draft',
      label: 'Saved draft (rev 1)',
      dirty: false,
    });
    expect(shouldGuardUnload(s)).toBe(false);
    s = editorReducer(s, {
      type: 'edit',
      draft: withName(d0, 'Hall'),
      label: 'Name',
      coalesceKey: 'identity.name',
    });
    expect(editorStatus(s)).toMatchObject({
      kind: 'unsaved',
      label: 'Unsaved local changes',
      serverLabel: 'Saved draft (rev 1)',
    });
    s = reduce(
      s,
      { type: 'server/start', op: 'save-draft' },
      {
        type: 'server/success',
        op: 'save-draft',
        head: head({ revision: 2, draftRevision: 2 }),
        draft: withName(d0, 'Hall'),
      },
    );
    expect(editorStatus(s).label).toBe('Saved draft (rev 2)');
    s = reduce(
      s,
      { type: 'server/start', op: 'validate' },
      { type: 'server/success', op: 'validate', validation: clean },
    );
    expect(publishBlockers(s)).toEqual([]);
    s = reduce(
      s,
      { type: 'server/start', op: 'publish' },
      {
        type: 'server/success',
        op: 'publish',
        head: head({ status: 'published', revision: 3, hasDraft: false, publishedVersion: 1 }),
        draft: withName(d0, 'Hall'),
      },
    );
    expect(editorStatus(s)).toMatchObject({
      kind: 'published',
      label: 'Published (version 1)',
      dirty: false,
    });
    expect(publishBlockers(s)).toContain('no-draft');
  });

  it('undo after a save shows unsaved changes (it never claims to undo the save)', () => {
    let s = placed();
    const d0 = currentDraft(s)!;
    s = reduce(
      s,
      { type: 'server/start', op: 'create' },
      { type: 'server/success', op: 'create', head: head() },
      { type: 'edit', draft: withName(d0, 'Hall'), label: 'Name' },
      { type: 'server/start', op: 'save-draft' },
      {
        type: 'server/success',
        op: 'save-draft',
        head: head({ revision: 2, draftRevision: 2 }),
        draft: withName(d0, 'Hall'),
      },
      { type: 'undo' },
    );
    expect(currentDraft(s)!.identity!.name).toBeNull();
    expect(editorStatus(s)).toMatchObject({ kind: 'unsaved', serverLabel: 'Saved draft (rev 2)' });
    expect(publishBlockers(s)).toContain('unsaved-changes');
  });

  it('a draft edited on top of a published version shows both', () => {
    const s = editorReducer(initialEditorState, {
      type: 'record/load',
      head: head({ status: 'published', hasDraft: true, draftRevision: 4, publishedVersion: 2 }),
      draft: draft(),
    });
    expect(editorStatus(s)).toMatchObject({
      kind: 'saved-draft',
      label: 'Saved draft (rev 4)',
      serverLabel: 'Published (version 2)',
    });
    expect(s.selectedId).toBe(STU_ID);
  });

  it('archived records are read-only until restored', () => {
    let s = editorReducer(initialEditorState, {
      type: 'record/load',
      head: head({ status: 'archived', hasDraft: false, publishedVersion: 1, archivedAt: T }),
      draft: draft(),
    });
    expect(editorStatus(s).label).toBe('Archived');
    s = editorReducer(s, { type: 'edit', draft: withName(draft(), 'X'), label: 'Name' });
    expect(currentDraft(s)!.identity!.name).toBeNull();
    expect(s.lastError?.message).toMatch(/Restore it/);
    expect(publishBlockers(s)).toContain('archived');
    s = reduce(
      s,
      { type: 'server/start', op: 'restore' },
      {
        type: 'server/success',
        op: 'restore',
        head: head({ status: 'published', hasDraft: false, publishedVersion: 1 }),
      },
    );
    expect(editorStatus(s).label).toBe('Published (version 1)');
  });

  it('failures keep the local draft and allow a retry; conflicts keep the server head', () => {
    let s = placed();
    s = reduce(
      s,
      { type: 'server/start', op: 'create' },
      { type: 'server/success', op: 'create', head: head() },
    );
    const edited = withName(currentDraft(s)!, 'Hall');
    s = reduce(s, { type: 'edit', draft: edited, label: 'Name' }, { type: 'server/start', op: 'save-draft' });
    expect(s.pending?.op).toBe('save-draft');
    // A second operation while one is pending is ignored.
    expect(editorReducer(s, { type: 'server/start', op: 'publish' })).toBe(s);
    s = editorReducer(s, { type: 'server/failure', op: 'save-draft', code: 'network', message: 'Offline' });
    expect(s.pending).toBeNull();
    expect(s.lastError).toEqual({ op: 'save-draft', code: 'network', message: 'Offline', retryable: true });
    expect(currentDraft(s)).toEqual(edited);
    expect(shouldGuardUnload(s)).toBe(true);
    s = reduce(s, { type: 'server/start', op: 'save-draft' });
    s = editorReducer(s, {
      type: 'server/failure',
      op: 'save-draft',
      code: 'conflict',
      message: 'Changed elsewhere',
      current: head({ revision: 7 }),
    });
    expect(s.conflict?.revision).toBe(7);
    expect(currentDraft(s)).toEqual(edited);
    expect(editorReducer(s, { type: 'error/dismiss' }).conflict).toBeNull();
    // A late success for an operation that is no longer pending is ignored.
    expect(editorReducer(s, { type: 'server/success', op: 'save-draft', head: head() })).toBe(s);
  });

  it('edits made during an in-flight save stay unsaved after it succeeds', () => {
    let s = placed();
    s = reduce(
      s,
      { type: 'server/start', op: 'create' },
      { type: 'server/success', op: 'create', head: head() },
    );
    const a = withName(currentDraft(s)!, 'Hall');
    const b = withName(currentDraft(s)!, 'Hall B');
    s = reduce(
      s,
      { type: 'edit', draft: a, label: 'Name' },
      { type: 'server/start', op: 'save-draft' },
      { type: 'edit', draft: b, label: 'Name' },
      { type: 'server/success', op: 'save-draft', head: head({ revision: 2, draftRevision: 2 }), draft: a },
    );
    expect(currentDraft(s)).toEqual(b);
    expect(editorStatus(s).kind).toBe('unsaved');
  });

  it('validation is tied to the draft it checked', () => {
    let s = placed();
    s = reduce(
      s,
      { type: 'server/start', op: 'create' },
      { type: 'server/success', op: 'create', head: head() },
      { type: 'server/start', op: 'validate' },
      { type: 'server/success', op: 'validate', validation: { ...clean, errorCount: 1, publishable: false } },
    );
    expect(publishBlockers(s)).toEqual(['validation-errors']);
    s = editorReducer(s, { type: 'edit', draft: withName(currentDraft(s)!, 'Hall'), label: 'Name' });
    expect(publishBlockers(s)).toEqual(expect.arrayContaining(['unsaved-changes', 'not-validated']));
  });

  it('delete clears everything; duplicate opens the new record', () => {
    let s = editorReducer(initialEditorState, {
      type: 'record/load',
      head: head({ status: 'archived', archivedAt: T }),
      draft: draft(),
    });
    s = reduce(s, { type: 'server/start', op: 'delete' }, { type: 'server/success', op: 'delete' });
    expect(s).toEqual(initialEditorState);
    const other = 'stu:cccccccccccccccccccccccc';
    s = editorReducer(initialEditorState, { type: 'record/load', head: head(), draft: draft() });
    s = reduce(
      s,
      { type: 'server/start', op: 'duplicate' },
      {
        type: 'server/success',
        op: 'duplicate',
        head: head({ id: other }),
        draft: draft({ identity: identity() }),
      },
    );
    expect(s.head?.id).toBe(other);
    expect(editorStatus(s).label).toBe('Saved draft (rev 1)');
  });
});

describe('gestures and map interaction (S13)', () => {
  it('a drag disables map interaction and records one command; cancel restores', () => {
    let s = placed();
    const d0 = currentDraft(s)!;
    s = editorReducer(s, { type: 'gesture/begin', label: 'Move' });
    expect(mapInteractionsEnabled(s)).toBe(false);
    expect(editorReducer(s, { type: 'select', id: 'osm:way/1' })).toBe(s); // selection suppressed
    expect(editorReducer(s, { type: 'undo' })).toBe(s);
    for (let i = 1; i <= 10; i++)
      s = editorReducer(s, {
        type: 'edit',
        draft: { ...d0, model: { ...d0.model, rotationDeg: i } },
        label: 'Rotate',
      });
    s = editorReducer(s, { type: 'gesture/end' });
    expect(mapInteractionsEnabled(s)).toBe(true);
    expect(s.history!.past).toHaveLength(1);
    s = editorReducer(s, { type: 'undo' });
    expect(currentDraft(s)!.model.rotationDeg).toBe(d0.model.rotationDeg);
    s = reduce(
      s,
      { type: 'gesture/begin', label: 'Move' },
      { type: 'edit', draft: { ...d0, model: { ...d0.model, rotationDeg: 99 } }, label: 'Rotate' },
      { type: 'gesture/cancel' },
    );
    expect(currentDraft(s)!.model.rotationDeg).toBe(d0.model.rotationDeg);
    expect(mapInteractionsEnabled(s)).toBe(true);
  });

  it('exit restores the initial state (normal map navigation)', () => {
    const s = reduce(placed(), { type: 'gesture/begin', label: 'Move' }, { type: 'exit' });
    expect(s).toEqual(initialEditorState);
    expect(mapInteractionsEnabled(s)).toBe(true);
  });
});
