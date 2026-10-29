import { describe, expect, it, vi } from 'vitest';
import { starterTemplate } from '../../../src/building-studio/asset-library.ts';
import { currentDraft } from '../../../src/building-studio/editor-state.ts';
import { nudgeMove } from '../../../src/building-studio/geometry.ts';
import { loadRecovery, saveRecovery } from '../../../src/building-studio/local-recovery.ts';
import type { StudioDraft } from '../../../src/building-studio/schema.ts';
import { describeAdminError } from '../../../src/admin/api/errors.ts';
import { createStudioActions } from '../../../src/building-studio/ui/actions.ts';
import {
  createStudioStore,
  currentValidation,
  missingAcks,
  studioPublishBlockers,
  studioStatus,
} from '../../../src/building-studio/ui/store.ts';
import { ANCHOR, draft, identity, STU_ID } from '../building-studio/fixtures.ts';
import {
  CROSSING_VALIDATION,
  detail,
  EMPTY_VALIDATION,
  fakeStudioApi,
  head,
  memoryStorage,
  offline,
  ok,
  problem,
} from './studio-fakes.ts';

const academic = starterTemplate('academic-block')!.definition;

function setup() {
  const api = fakeStudioApi();
  const store = createStudioStore();
  const storage = memoryStorage();
  const onRecordChange = vi.fn();
  const onPublicationChange = vi.fn();
  const actions = createStudioActions({
    api,
    describeError: describeAdminError,
    store,
    storage,
    onRecordChange,
    onPublicationChange,
  });
  const edit = (fn: (d: StudioDraft) => StudioDraft, label = 'edit') =>
    store.dispatch({ type: 'edit', draft: fn(currentDraft(store.getState().editor)!), label });
  return { api, store, storage, actions, onRecordChange, onPublicationChange, edit };
}

/** A placed, confirmed, never-saved building. */
function placed(t: ReturnType<typeof setup>) {
  t.actions.startPlacement(academic, academic.variants[0]!.id, ANCHOR);
  t.actions.confirmPlacement();
  return currentDraft(t.store.getState().editor)!;
}

describe('placement and the first save', () => {
  it('placement is a preview; confirming makes an unsaved local draft with the template category and no name', () => {
    const t = setup();
    expect(t.actions.startPlacement(academic, 'plain', ANCHOR)).toBe(true);
    const s = t.store.getState();
    expect(s.editor.history).toBeNull();
    expect(s.editor.placement?.model.anchor).toEqual(ANCHOR);
    t.actions.confirmPlacement();
    const d = currentDraft(t.store.getState().editor)!;
    expect(d.identity).toMatchObject({ name: null, categoryId: academic.suggestedCategoryId });
    expect(d.templateRef).toEqual({ templateId: 'academic-block', templateVersion: 1, variantId: 'plain' });
    expect(studioStatus(t.store.getState()).label).toBe('Unsaved local changes (not on the server yet)');
  });

  it('Save draft creates the record, reports the server revision and opens its URL', async () => {
    const t = setup();
    const d = placed(t);
    saveRecovery('new', d, { storage: t.storage });
    t.api.createBuilding.mockResolvedValue(ok(detail({}, d), 201));
    expect(await t.actions.saveDraft()).toBe(true);
    expect(t.api.createBuilding).toHaveBeenCalledWith({ targetId: null, draft: d });
    const s = t.store.getState();
    expect(studioStatus(s).label).toBe('Saved draft (rev 1)');
    expect(s.notice?.message).toMatch(/Saved on the server as a draft \(rev 1\)/);
    expect(t.onRecordChange).toHaveBeenCalledWith(STU_ID);
    expect(loadRecovery('new', { storage: t.storage })).toBeNull();
  });

  it('a failed save (500) is a failure: nothing claims success, the draft stays unsaved', async () => {
    const t = setup();
    placed(t);
    t.api.createBuilding.mockResolvedValue(problem(500, 'internal', 'Internal error'));
    expect(await t.actions.saveDraft()).toBe(false);
    const s = t.store.getState();
    expect(s.editor.lastError).toMatchObject({ op: 'create', retryable: true });
    expect(s.notice).toBeNull();
    expect(studioStatus(s).kind).toBe('unsaved');
    expect(s.editor.head).toBeNull();
  });

  it('failures are worded by the injected describeError (the Studio never imports the admin client)', async () => {
    const api = fakeStudioApi();
    const store = createStudioStore();
    const describeError = vi.fn((e: { kind: string; code: string | null }) => `custom: ${e.kind}/${e.code}`);
    const actions = createStudioActions({ api, describeError, store, storage: memoryStorage() });
    actions.startPlacement(academic, academic.variants[0]!.id, ANCHOR);
    actions.confirmPlacement();
    api.createBuilding.mockResolvedValue(problem(409, 'conflict', 'Changed elsewhere'));
    expect(await actions.saveDraft()).toBe(false);
    expect(describeError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'conflict', code: 'conflict' }),
    );
    expect(store.getState().editor.lastError).toMatchObject({
      op: 'create',
      code: 'conflict',
      message: 'custom: conflict/conflict',
    });
  });

  it('no response for a write: the outcome is stated as unknown', async () => {
    const t = setup();
    placed(t);
    t.api.createBuilding.mockResolvedValue(offline());
    await t.actions.saveDraft();
    expect(t.store.getState().editor.lastError?.message).toMatch(/not known whether the change was saved/);
  });

  it('field problems are not sent: no request, a clear notice', async () => {
    const t = setup();
    placed(t);
    t.edit((d) => ({ ...d, identity: identity({ name: 'A' }) }));
    expect(await t.actions.saveDraft()).toBe(false);
    expect(t.api.createBuilding).not.toHaveBeenCalled();
    expect(t.store.getState().notice?.message).toMatch(/one field has a problem/);
  });
});

describe('saved drafts: undo across a save, conflicts', () => {
  async function opened(t: ReturnType<typeof setup>, d = draft()) {
    t.api.getBuilding.mockResolvedValue(ok(detail({ validation: EMPTY_VALIDATION }, d)));
    await t.actions.open(STU_ID);
  }

  it('open loads the server copy and its validation of exactly that draft', async () => {
    const t = setup();
    await opened(t);
    const s = t.store.getState();
    expect(studioStatus(s).label).toBe('Saved draft (rev 1)');
    expect(currentValidation(s)).toEqual(EMPTY_VALIDATION);
    expect(studioPublishBlockers(s)).toEqual([]);
  });

  it('undo after a save makes the draft unsaved again (never "undoes" the server); redo is clean again', async () => {
    const t = setup();
    await opened(t);
    t.edit((d) => ({ ...d, model: nudgeMove(d.model, 'north', 5) }), 'Move');
    const moved = currentDraft(t.store.getState().editor)!;
    t.api.saveDraft.mockResolvedValue(ok(detail({ head: head({ revision: 2, draftRevision: 2 }) }, moved)));
    await t.actions.saveDraft();
    expect(t.api.saveDraft).toHaveBeenCalledWith(STU_ID, { revision: 1, draft: moved });
    expect(studioStatus(t.store.getState()).label).toBe('Saved draft (rev 2)');
    t.store.dispatch({ type: 'undo' });
    expect(studioStatus(t.store.getState())).toMatchObject({
      kind: 'unsaved',
      serverLabel: 'Saved draft (rev 2)',
    });
    expect(studioPublishBlockers(t.store.getState())).toContain('unsaved-changes');
    t.store.dispatch({ type: 'redo' });
    expect(studioStatus(t.store.getState()).label).toBe('Saved draft (rev 2)');
  });

  it('409: the server head is shown; "re-check and save mine" validates, then saves with the new revision', async () => {
    const t = setup();
    await opened(t);
    t.edit((d) => ({ ...d, model: nudgeMove(d.model, 'east', 1) }));
    const theirs = head({ revision: 5, draftRevision: 4, updatedBy: 'owner@other' });
    t.api.saveDraft.mockResolvedValueOnce(problem(409, 'conflict', 'Changed elsewhere', { current: theirs }));
    expect(await t.actions.saveDraft()).toBe(false);
    expect(t.store.getState().editor.conflict).toEqual(theirs);
    expect(studioStatus(t.store.getState()).kind).toBe('unsaved');
    const mine = currentDraft(t.store.getState().editor)!;
    t.api.saveDraft.mockResolvedValueOnce(
      ok(detail({ head: head({ revision: 6, draftRevision: 5 }) }, mine)),
    );
    expect(await t.actions.overwriteAfterConflict()).toBe(true);
    expect(t.api.validate).toHaveBeenCalledWith(
      { targetId: null, draft: mine, recordId: STU_ID },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(t.api.saveDraft).toHaveBeenLastCalledWith(STU_ID, { revision: 5, draft: mine });
    expect(t.store.getState().editor.conflict).toBeNull();
  });

  it('409: "load the server version" drops local changes and reloads', async () => {
    const t = setup();
    await opened(t);
    t.edit((d) => ({ ...d, model: nudgeMove(d.model, 'east', 1) }));
    t.api.saveDraft.mockResolvedValueOnce(problem(409, 'conflict', 'x', { current: head({ revision: 3 }) }));
    await t.actions.saveDraft();
    const server = draft({ identity: identity({ name: 'Theirs' }) });
    t.api.getBuilding.mockResolvedValue(ok(detail({ head: head({ revision: 3 }) }, server)));
    expect(await t.actions.reloadFromServer()).toBe(true);
    expect(currentDraft(t.store.getState().editor)).toEqual(server);
    expect(studioStatus(t.store.getState()).dirty).toBe(false);
  });

  it('Cancel (discard local changes) returns to the saved draft without a request', async () => {
    const t = setup();
    await opened(t);
    t.edit((d) => ({ ...d, model: nudgeMove(d.model, 'east', 1) }));
    t.actions.discardLocalChanges();
    expect(currentDraft(t.store.getState().editor)).toEqual(draft());
    expect(studioStatus(t.store.getState()).dirty).toBe(false);
  });
});

describe('validation and publishing', () => {
  it('the server check is kept with the exact draft; any edit makes it stale', async () => {
    const t = setup();
    placed(t);
    t.api.validate.mockResolvedValue(ok(CROSSING_VALIDATION));
    expect(await t.actions.validate()).toBe(true);
    expect(currentValidation(t.store.getState())).toEqual(CROSSING_VALIDATION);
    t.edit((d) => ({ ...d, model: nudgeMove(d.model, 'east', 1) }));
    expect(currentValidation(t.store.getState())).toBeNull();
  });

  it('validating a placement preview checks the draft it would create', async () => {
    const t = setup();
    t.actions.startPlacement(academic, 'plain', ANCHOR);
    await t.actions.validate();
    const body = t.api.validate.mock.calls[0]![0] as { draft: StudioDraft; targetId: null; recordId: null };
    expect(body.recordId).toBeNull();
    expect(body.draft.identity?.categoryId).toBe(academic.suggestedCategoryId);
    expect(currentValidation(t.store.getState())).toEqual(EMPTY_VALIDATION);
  });

  it('a draft with field problems is not sent for checking', async () => {
    const t = setup();
    placed(t);
    t.edit((d) => ({ ...d, identity: identity({ name: 'A' }) }));
    expect(await t.actions.validate()).toBe(false);
    expect(t.api.validate).not.toHaveBeenCalled();
    expect(t.store.getState().validationError).toMatch(/Fix the field problem/);
  });

  async function readyToPublish(t: ReturnType<typeof setup>) {
    t.api.getBuilding.mockResolvedValue(ok(detail({ validation: CROSSING_VALIDATION })));
    await t.actions.open(STU_ID);
  }

  it('publish needs an acknowledgement per warning; it is sent with the trimmed change summary', async () => {
    const t = setup();
    await readyToPublish(t);
    expect(missingAcks(t.store.getState())).toEqual(['boundary-crossing']);
    t.store.setState({ acknowledgements: { 'boundary-crossing': '  Canopy reaches the road edge  ' } });
    expect(missingAcks(t.store.getState())).toEqual([]);
    const published = detail({
      head: head({ status: 'published', revision: 2, hasDraft: false, publishedVersion: 1 }),
      draft: null,
      published: {
        version: 1,
        record: draft(),
        footprint: {
          type: 'Polygon',
          coordinates: [[ANCHOR, [ANCHOR[0] + 0.001, ANCHOR[1]], [ANCHOR[0], ANCHOR[1] + 0.001], ANCHOR]],
        },
        footprintAreaM2: 100,
        membership: {
          campusStatus: 'crossing',
          insideFraction: 0.8,
          distanceToBoundaryM: 0,
          reasonCode: 'crossing-majority',
          decision: 'auto',
          decisionSource: null,
        },
        acknowledgements: [],
        changeSummary: 'First',
        publishedBy: 'owner',
        publishedAt: '2026-10-24T10:00:00.000Z',
      },
    });
    t.api.publish.mockResolvedValue(ok({ building: published, publicationVersion: 7 }));
    expect(await t.actions.publish('  First publication  ')).toBe(true);
    expect(t.api.publish).toHaveBeenCalledWith(STU_ID, {
      revision: 1,
      acknowledgements: [{ code: 'boundary-crossing', reason: 'Canopy reaches the road edge' }],
      changeSummary: 'First publication',
    });
    expect(studioStatus(t.store.getState()).label).toBe('Published (version 1)');
    expect(t.store.getState().notice?.message).toBe('Published as version 1 (public data revision 7).');
    expect(t.onPublicationChange).toHaveBeenCalledTimes(1);
  });

  it('422 validation-failed: not published; the server validation and missing acknowledgements are shown', async () => {
    const t = setup();
    await readyToPublish(t);
    t.api.publish.mockResolvedValue(
      problem(422, 'validation-failed', 'Acknowledge every warning', {
        validation: CROSSING_VALIDATION,
        missingAcknowledgements: ['boundary-crossing'],
      }),
    );
    expect(await t.actions.publish('First publication')).toBe(false);
    const s = t.store.getState();
    expect(s.editor.lastError?.op).toBe('publish');
    expect(currentValidation(s)).toEqual(CROSSING_VALIDATION);
    expect(studioStatus(s).label).toBe('Saved draft (rev 1)');
    expect(t.onPublicationChange).not.toHaveBeenCalled();
  });
});

describe('archive, restore, delete, duplicate', () => {
  it('archive → restore → delete with the typed id, each confirmed by the server', async () => {
    const t = setup();
    t.api.getBuilding.mockResolvedValue(
      ok(detail({ head: head({ status: 'published', publishedVersion: 1, hasDraft: false }) })),
    );
    await t.actions.open(STU_ID);
    const archivedHead = head({
      status: 'archived',
      revision: 2,
      publishedVersion: 1,
      hasDraft: false,
      archivedAt: '2026-10-24T11:00:00.000Z',
    });
    t.api.archive.mockResolvedValue(ok({ building: detail({ head: archivedHead }), publicationVersion: 3 }));
    expect(await t.actions.archive('  ')).toBe(true);
    expect(t.api.archive).toHaveBeenCalledWith(STU_ID, { revision: 1, reason: null });
    expect(studioStatus(t.store.getState()).label).toBe('Archived');
    // Editing an archived building is refused by the reducer.
    t.edit((d) => d);
    t.api.restore.mockResolvedValue(
      ok({
        building: detail({
          head: head({ status: 'published', revision: 3, publishedVersion: 1, hasDraft: false }),
        }),
        publicationVersion: 4,
      }),
    );
    expect(await t.actions.restore()).toBe(true);
    expect(t.store.getState().notice?.message).toBe('Restored: version 1 is public again.');
    t.store.setState({ editor: { ...t.store.getState().editor, head: archivedHead } });
    t.api.deleteBuilding.mockResolvedValue(ok({ deletedId: STU_ID, auditEventId: 42 }));
    expect(await t.actions.deleteRecord(STU_ID)).toBe(true);
    expect(t.api.deleteBuilding).toHaveBeenCalledWith(STU_ID, { revision: 2, confirmId: STU_ID });
    expect(t.store.getState().editor.history).toBeNull();
    expect(t.onRecordChange).toHaveBeenLastCalledWith(null);
    expect(t.onPublicationChange).toHaveBeenCalledTimes(3);
  });

  it('duplicate opens the new draft', async () => {
    const t = setup();
    t.api.getBuilding.mockResolvedValue(ok(detail()));
    await t.actions.open(STU_ID);
    const copyId = 'stu:zzzzzzzzzzzzzzzzzzzzzzzz';
    t.api.duplicate.mockResolvedValue(ok(detail({ head: head({ id: copyId }) }), 201));
    expect(await t.actions.duplicate()).toBe(true);
    expect(t.api.duplicate).toHaveBeenCalledWith(STU_ID, { offsetM: null });
    expect(t.store.getState().editor.head?.id).toBe(copyId);
    expect(t.onRecordChange).toHaveBeenCalledWith(copyId);
  });
});

describe('apply template vN', () => {
  it('a saved, unchanged record previews on the server (dry run), then applies there', async () => {
    const t = setup();
    t.api.getBuilding.mockResolvedValue(ok(detail()));
    await t.actions.open(STU_ID);
    const after = draft({
      templateRef: { templateId: 'academic-block', templateVersion: 1, variantId: 'ribbon-hip' },
    });
    t.api.applyTemplate.mockResolvedValueOnce(
      ok({
        draft: after,
        changedFields: ['templateRef.variantId'],
        validation: EMPTY_VALIDATION,
        saved: false,
        building: null,
      }),
    );
    const p = await t.actions.previewTemplate(academic, 'ribbon-hip');
    if ('error' in p) throw new Error(p.error);
    expect(p.source).toBe('server');
    expect(t.api.applyTemplate).toHaveBeenCalledWith(
      STU_ID,
      expect.objectContaining({ dryRun: true, variantId: 'ribbon-hip' }),
    );
    expect(t.store.getState().editor.pending).toBeNull();
    t.api.applyTemplate.mockResolvedValueOnce(
      ok({
        draft: after,
        changedFields: [],
        validation: EMPTY_VALIDATION,
        saved: true,
        building: detail({ head: head({ revision: 2, draftRevision: 2 }) }, after),
      }),
    );
    expect(await t.actions.applyTemplate(p)).toBe(true);
    expect(currentDraft(t.store.getState().editor)).toEqual(after);
    expect(studioStatus(t.store.getState()).label).toBe('Saved draft (rev 2)');
  });

  it('a draft with unsaved changes previews and applies locally, as one undoable edit', async () => {
    const t = setup();
    placed(t);
    const p = await t.actions.previewTemplate(academic, 'ribbon-hip');
    if ('error' in p) throw new Error(p.error);
    expect(p.source).toBe('local');
    expect(p.changedFields).toContain('model.roof.shape');
    expect(t.api.applyTemplate).not.toHaveBeenCalled();
    await t.actions.applyTemplate(p);
    expect(currentDraft(t.store.getState().editor)?.templateRef?.variantId).toBe('ribbon-hip');
    t.store.dispatch({ type: 'undo' });
    expect(currentDraft(t.store.getState().editor)?.templateRef?.variantId).toBe('plain');
  });
});

describe('existing base buildings', () => {
  const square = [
    [
      ANCHOR,
      [ANCHOR[0] + 0.0002, ANCHOR[1]],
      [ANCHOR[0] + 0.0002, ANCHOR[1] + 0.0002],
      [ANCHOR[0], ANCHOR[1] + 0.0002],
      ANCHOR,
    ],
  ] as [number, number][][];

  it('opens the existing studio record of a target instead of creating a second one', async () => {
    const t = setup();
    t.api.listBuildings.mockResolvedValue(
      ok({
        items: [
          {
            id: STU_ID,
            targetId: 'osm:way/1',
            status: 'draft',
            title: 'X',
            categoryId: null,
            revision: 1,
            hasDraft: true,
            publishedVersion: null,
            updatedAt: '2026-10-24T09:30:00.000Z',
            errorCount: 0,
            warningCount: 0,
            modelAvailable: true,
          },
        ],
        nextCursor: null,
      }),
    );
    expect(await t.actions.modelBaseBuilding('osm:way/1', square, 12)).toBe('opened');
    expect(t.api.listBuildings).toHaveBeenCalledWith({ targetId: 'osm:way/1' });
    expect(t.onRecordChange).toHaveBeenCalledWith(STU_ID);
  });

  it('otherwise starts a local model of the mapped footprint (no identity; labelled starting values)', async () => {
    const t = setup();
    expect(await t.actions.modelBaseBuilding('osm:way/1', square, 12.04)).toBe('started');
    const s = t.store.getState();
    const d = currentDraft(s.editor)!;
    expect(s.editor.targetId).toBe('osm:way/1');
    expect(d.identity).toBeNull();
    expect(d.model.generatorId).toBe('footprint-prism');
    expect(d.model).toMatchObject({ heightM: 12, floors: 4 });
    expect(s.notice?.message).toMatch(/neither is a measurement/);
  });
});

describe('crash recovery (S8)', () => {
  it('unsaved edits are stored in this browser and offered when the record is opened again', async () => {
    const t = setup();
    t.api.getBuilding.mockResolvedValue(ok(detail()));
    await t.actions.open(STU_ID);
    expect(t.actions.persistRecovery()).toBe(false); // nothing unsaved
    t.edit((d) => ({ ...d, model: nudgeMove(d.model, 'east', 2) }));
    expect(t.actions.persistRecovery()).toBe(true);
    const mine = currentDraft(t.store.getState().editor)!;

    // A fresh page (same browser storage).
    const store2 = createStudioStore();
    const a2 = createStudioActions({
      api: t.api,
      describeError: describeAdminError,
      store: store2,
      storage: t.storage,
    });
    await a2.open(STU_ID);
    expect(store2.getState().recovery?.draft).toEqual(mine);
    expect(studioStatus(store2.getState()).dirty).toBe(false);
    a2.restoreRecovery();
    expect(currentDraft(store2.getState().editor)).toEqual(mine);
    expect(studioStatus(store2.getState()).dirty).toBe(true);
  });

  it('the copy is dropped once undo/redo returns exactly to the saved state', async () => {
    const t = setup();
    t.api.getBuilding.mockResolvedValue(ok(detail()));
    await t.actions.open(STU_ID);
    t.edit((d) => ({ ...d, model: nudgeMove(d.model, 'east', 2) }));
    t.actions.persistRecovery();
    expect(loadRecovery(STU_ID, { storage: t.storage })).not.toBeNull();
    t.actions.forgetRecoveryIfClean(); // still unsaved: kept
    expect(loadRecovery(STU_ID, { storage: t.storage })).not.toBeNull();
    t.store.dispatch({ type: 'undo' });
    t.actions.forgetRecoveryIfClean();
    expect(loadRecovery(STU_ID, { storage: t.storage })).toBeNull();
  });

  it('a never-saved building is recovered as a local draft; dismissing deletes the copy', () => {
    const t = setup();
    saveRecovery('new', draft(), { storage: t.storage });
    t.actions.checkNewRecovery();
    expect(t.store.getState().recovery?.key).toBe('new');
    t.actions.restoreRecovery();
    expect(currentDraft(t.store.getState().editor)).toEqual(draft());
    expect(t.store.getState().editor.head).toBeNull();
    saveRecovery('new', draft(), { storage: t.storage });
    t.actions.checkNewRecovery();
    t.actions.dismissRecovery();
    expect(loadRecovery('new', { storage: t.storage })).toBeNull();
  });
});
