import { describe, expect, it } from 'vitest';
import { currentDraft } from '../../../src/building-studio/editor-state.ts';
import {
  adoptConflictHead,
  checkTarget,
  createStudioStore,
  currentValidation,
  hydrateLocalDraft,
  missingAcks,
  studioPublishBlockers,
  validAckReason,
} from '../../../src/building-studio/ui/store.ts';
import { draft, model } from '../building-studio/fixtures.ts';
import { CROSSING_VALIDATION, head } from './studio-fakes.ts';

describe('Studio store', () => {
  it('opening another record drops the previous record’s acknowledgements, proposal and recovery offer', () => {
    const store = createStudioStore();
    store.dispatch({ type: 'record/load', head: head(), draft: draft() });
    store.setState({
      acknowledgements: { 'boundary-crossing': 'reason given' },
      proposal: { ok: true, kind: 'angle', model: model(), changes: [], explanation: 'x' },
    });
    store.dispatch({
      type: 'record/load',
      head: head({ id: 'stu:zzzzzzzzzzzzzzzzzzzzzzzz' }),
      draft: draft(),
    });
    expect(store.getState().acknowledgements).toEqual({});
    expect(store.getState().proposal).toBeNull();
  });

  it('an edit drops a shown snapping proposal (it was computed for the previous model)', () => {
    const store = createStudioStore();
    store.dispatch({ type: 'record/load', head: head(), draft: draft() });
    store.setState({ proposal: { ok: true, kind: 'angle', model: model(), changes: [], explanation: 'x' } });
    const d = currentDraft(store.getState().editor)!;
    store.dispatch({ type: 'edit', draft: { ...d, model: { ...d.model, heightM: 20 } }, label: 'h' });
    expect(store.getState().proposal).toBeNull();
  });

  it('validation counts only for the exact draft and target it was computed for', () => {
    const store = createStudioStore();
    store.dispatch({ type: 'record/load', head: head(), draft: draft() });
    store.setState({ validation: { result: CROSSING_VALIDATION, draft: draft(), targetId: null } });
    expect(currentValidation(store.getState())).toBe(CROSSING_VALIDATION);
    expect(missingAcks(store.getState())).toEqual(['boundary-crossing']);
    expect(studioPublishBlockers(store.getState())).toEqual([]);
    store.setState({ validation: { result: CROSSING_VALIDATION, draft: draft(), targetId: 'osm:way/1' } });
    expect(currentValidation(store.getState())).toBeNull();
    expect(studioPublishBlockers(store.getState())).toEqual(['not-validated']);
  });

  it('acknowledgement reasons need 5–300 characters', () => {
    expect(validAckReason('ok')).toBe(false);
    expect(validAckReason('  fine  ')).toBe(false);
    expect(validAckReason('canopy over the walkway')).toBe(true);
    expect(validAckReason('x'.repeat(301))).toBe(false);
  });

  it('a local-only recovered draft opens unsaved; a conflict head becomes the base of the next save', () => {
    const store = createStudioStore();
    store.setState(hydrateLocalDraft(store.getState(), draft(), 'osm:way/7'));
    expect(store.getState().editor.targetId).toBe('osm:way/7');
    expect(checkTarget(store.getState())?.targetId).toBe('osm:way/7');
    store.dispatch({ type: 'record/load', head: head(), draft: draft() });
    const adopted = adoptConflictHead(store.getState(), head({ revision: 9 }));
    expect(adopted.editor.head?.revision).toBe(9);
    expect(adopted.editor.history?.savedMarker).toBeNull(); // the local copy is unsaved against it
  });
});
