/**
 * Server operations of the Building Studio, wired to the UI store. Every
 * call goes through the server port the caller injects (../server-api.ts; the
 * admin passes its typed client, src/admin/api/studio.ts, and its error
 * wording), so the Studio never imports the admin. A
 * failure is ALWAYS reported as a failure — the local draft is kept, the
 * state badge keeps saying "unsaved", and the error says whether the outcome
 * is unknown. Success notices quote what the server returned (revision,
 * version), never what the client hoped for.
 */
import type { LngLat } from '../../data/index.ts';
import { jsonEqual } from '../index.ts';
import { currentDraft, shouldGuardUnload, type ServerOp } from '../editor.ts';
import { footprintPrismPlacement } from '../editor.ts';
import { clearRecovery, loadRecovery, recoveryKey, saveRecovery, type RecoveryStorage } from '../editor.ts';
import {
  WARNING_CODES,
  studioBuildingHeadSchema,
  type ModelConfigV1,
  type StudioBuildingDetail,
  type StudioDraft,
  type TemplateDefinition,
  type TemplateRef,
} from '../index.ts';
import { applyTemplateVersion } from '../editor.ts';
import { defaultIdentity, draftSchemaIssues } from './fields.ts';
import type { StudioServerApi, StudioServerFailure } from '../index.ts';
import {
  adoptConflictHead,
  checkTarget,
  currentValidation,
  hydrateLocalDraft,
  validAckReason,
  type StudioNotice,
  type StudioStore,
} from './store.ts';

export interface StudioActionsDeps<E extends StudioServerFailure = StudioServerFailure> {
  api: StudioServerApi<E>;
  /** One sentence for a failure (banner, notice); never claims success. The admin passes describeAdminError. */
  describeError(error: E): string;
  store: StudioStore;
  /** The open record changed (navigate to /admin/studio/<id>, or the list for null). */
  onRecordChange?(id: string | null): void;
  /** The public map changed (publish, archive, restore, delete): refresh the context data. */
  onPublicationChange?(): void;
  storage?: RecoveryStorage | null;
}

export interface ApplyTemplatePreview {
  ref: TemplateRef;
  before: StudioDraft;
  after: StudioDraft;
  changedFields: string[];
  /** 'server' = dry run on the server (validated there); 'local' = computed here for an unsaved draft. */
  source: 'server' | 'local';
  warnings: string[];
}

const errCode = (e: StudioServerFailure): string => e.code ?? e.kind;

/** The draft shown for a server detail: the draft, else the published record. */
export const shownDraft = (d: StudioBuildingDetail): StudioDraft | null =>
  d.draft ?? d.published?.record ?? null;

export type StudioActions = ReturnType<typeof createStudioActions>;

export function createStudioActions<E extends StudioServerFailure>(deps: StudioActionsDeps<E>) {
  const { api, store, describeError } = deps;
  const storageOpt = deps.storage === undefined ? {} : { storage: deps.storage };
  let validateCtl: AbortController | null = null;

  const notice = (n: StudioNotice | null) => store.setState({ notice: n });
  const state = () => store.getState();
  const key = () => {
    const e = state().editor;
    return recoveryKey(e.head?.id ?? null, e.head?.targetId ?? e.targetId);
  };

  function start(op: ServerOp): boolean {
    store.dispatch({ type: 'server/start', op });
    return state().editor.pending?.op === op;
  }

  function fail(op: ServerOp, e: E): void {
    const parsed = e.kind === 'conflict' ? studioBuildingHeadSchema.safeParse(e.current) : null;
    store.dispatch({
      type: 'server/failure',
      op,
      code: errCode(e),
      message: describeError(e),
      ...(parsed?.success ? { current: parsed.data } : {}),
    });
    const t = checkTarget(state());
    if (e.validation && t) store.setState({ validation: { result: e.validation, ...t } });
    notice(null);
  }

  /** Records a server detail as the open record's server state. */
  function adopt(d: StudioBuildingDetail): void {
    const draft = shownDraft(d);
    store.setState({
      detail: d,
      baseline: draft,
      ...(d.validation && draft
        ? { validation: { result: d.validation, draft, targetId: d.head.targetId } }
        : {}),
    });
  }

  function checkRecovery(serverDraft: StudioDraft | null): void {
    const entry = loadRecovery(key(), storageOpt);
    if (entry && serverDraft && jsonEqual(entry.draft, serverDraft)) {
      clearRecovery(key(), storageOpt);
      store.setState({ recovery: null });
      return;
    }
    store.setState({ recovery: entry });
  }

  const actions = {
    /** Opens a record from the server (the route /admin/studio/<id>). */
    async open(id: string): Promise<boolean> {
      if (!start('load')) return false;
      const r = await api.getBuilding(id);
      if (!r.ok) {
        fail('load', r.error);
        return false;
      }
      const draft = shownDraft(r.data);
      if (!draft) {
        store.dispatch({
          type: 'server/failure',
          op: 'load',
          code: 'bad-response',
          message: 'The server returned this building without a draft or a published version.',
        });
        return false;
      }
      store.dispatch({ type: 'server/success', op: 'load', head: r.data.head, draft });
      adopt(r.data);
      checkRecovery(draft);
      return true;
    },

    /** Offers crash recovery of a building that was never saved (no server record). */
    checkNewRecovery(targetId: string | null = null): void {
      const entry = loadRecovery(recoveryKey(null, targetId), storageOpt);
      store.setState({ recovery: entry });
    },

    restoreRecovery(): void {
      const s = state();
      const entry = s.recovery;
      if (!entry) return;
      if (s.editor.history) {
        store.dispatch({ type: 'edit', draft: entry.draft, label: 'Restore recovered changes' });
        store.setState({ recovery: null });
      } else {
        const targetId = entry.key.startsWith('new:') ? entry.key.slice(4) : null;
        store.setState(hydrateLocalDraft(state(), entry.draft, targetId));
      }
      notice({
        tone: 'info',
        message: 'Recovered changes restored. They are not on the server until you save the draft.',
      });
    },

    dismissRecovery(): void {
      const entry = state().recovery;
      if (entry) clearRecovery(entry.key, storageOpt);
      store.setState({ recovery: null });
    },

    /** Stores unsaved local edits in this browser (crash recovery only; never authoritative). */
    persistRecovery(): boolean {
      const s = state();
      const draft = currentDraft(s.editor);
      if (!draft || !shouldGuardUnload(s.editor) || s.recovery) return false;
      return saveRecovery(key(), draft, { ...storageOpt, baseRevision: s.editor.head?.revision ?? null });
    },

    /**
     * Drops this browser's copy once the open draft is exactly the server's again
     * (e.g. redo back to the saved state). An entry being offered is kept.
     */
    forgetRecoveryIfClean(): void {
      const s = state();
      const h = s.editor.history;
      // A freshly loaded record (no commands yet) is left alone: its stored copy may be on offer.
      if (s.recovery || !s.editor.head || !h || h.past.length + h.future.length === 0) return;
      if (shouldGuardUnload(s.editor)) return;
      clearRecovery(key(), storageOpt);
    },

    /** Starts placing a template variant (translucent preview, not yet a draft). */
    startPlacement(def: TemplateDefinition, variantId: string, anchor: LngLat): boolean {
      const variant = def.variants.find((v) => v.id === variantId) ?? def.variants[0];
      if (!variant) return false;
      const model: ModelConfigV1 = structuredClone({
        modelConfigVersion: 1 as const,
        anchor: [anchor[0], anchor[1]] as LngLat,
        rotationDeg: 0,
        ...variant.defaults,
      });
      store.setState({ placementCategoryId: def.suggestedCategoryId, proposal: null });
      store.dispatch({
        type: 'placement/start',
        templateRef: { templateId: def.id, templateVersion: def.version, variantId: variant.id },
        model,
      });
      return state().editor.placement !== null;
    },

    /** Confirms the placement: the model becomes a local draft (saved on the server with Save draft). */
    confirmPlacement(): void {
      const s = state();
      const p = s.editor.placement;
      if (!p) return;
      store.dispatch({
        type: 'placement/confirm',
        identity: p.targetId ? null : defaultIdentity(s.placementCategoryId),
      });
      notice({ tone: 'info', message: 'Placed. Nothing is on the server until you save the draft.' });
    },

    /**
     * Model of an existing base building. An existing studio record for the
     * target is opened instead (one record per target); otherwise a local
     * 'footprint-prism' draft starts from the mapped footprint. The starting
     * height comes from the map's current rendering and is labelled as such.
     */
    async modelBaseBuilding(
      targetId: string,
      footprint: readonly (readonly LngLat[])[],
      startHeightM: number,
    ): Promise<'opened' | 'started' | 'failed'> {
      const list = await api.listBuildings({ targetId });
      if (!list.ok) {
        notice({ tone: 'danger', message: describeError(list.error) });
        return 'failed';
      }
      const existing = list.data.items[0];
      if (existing) {
        deps.onRecordChange?.(existing.id);
        return 'opened';
      }
      const placement = footprintPrismPlacement(footprint);
      if (!placement) {
        notice({ tone: 'danger', message: 'This building has no usable mapped footprint.' });
        return 'failed';
      }
      const floorHeightM = 3.2;
      const heightM = Math.round(Math.max(2.4, startHeightM) * 10) / 10;
      const model: ModelConfigV1 = {
        modelConfigVersion: 1,
        generatorId: 'footprint-prism',
        generatorVersion: 1,
        anchor: placement.anchor,
        rotationDeg: 0,
        widthM: Math.max(0.1, Math.round(placement.widthM * 10) / 10),
        lengthM: Math.max(0.1, Math.round(placement.lengthM * 10) / 10),
        heightM,
        floors: Math.max(1, Math.round(heightM / floorHeightM)),
        floorHeightM,
        baseOffsetM: 0,
        shape: { kind: 'footprint-prism' },
        roof: { shape: 'flat', colour: '#b0a99f', material: 'concrete' },
        facade: {
          material: 'plaster',
          wallColour: '#e8dcc8',
          windowPattern: 'punched',
          windowDensity: 0.4,
          balconies: false,
          entranceSide: 'none',
        },
        detailLevel: 'facade',
      };
      store.setState(
        hydrateLocalDraft(
          state(),
          {
            identity: null,
            model,
            verification: { status: 'unverified' },
            accessNodeId: null,
            templateRef: null,
            positionCorrection: null,
          },
          targetId,
        ),
      );
      store.setState({ editor: { ...state().editor, selectedId: targetId } });
      notice({
        tone: 'info',
        message:
          'Modelling the mapped footprint. The starting height is copied from the current map rendering and the floors are derived from it: neither is a measurement.',
      });
      actions.checkNewRecovery(targetId);
      return 'started';
    },

    /** Server check of the open (or previewed) draft. Field problems are reported without a request. */
    async validate(): Promise<boolean> {
      const t = checkTarget(state());
      if (!t) return false;
      validateCtl?.abort();
      const issues = draftSchemaIssues(t.draft);
      if (issues.length > 0) {
        store.setState({
          validating: false,
          validationError: `Fix ${issues.length === 1 ? 'the field problem' : `${issues.length} field problems`} before the server can check this draft.`,
        });
        return false;
      }
      const ctl = new AbortController();
      validateCtl = ctl;
      store.setState({ validating: true, validationError: null });
      const recordId = state().editor.head?.id ?? null;
      const r = await api.validate(
        { targetId: t.targetId, draft: t.draft, recordId },
        { signal: ctl.signal },
      );
      if (validateCtl !== ctl) return false; // superseded
      validateCtl = null;
      if (!r.ok) {
        if (r.error.kind === 'aborted') return false;
        store.setState({ validating: false, validationError: describeError(r.error) });
        return false;
      }
      store.setState({ validating: false, validationError: null, validation: { result: r.data, ...t } });
      return true;
    },

    cancelValidation(): void {
      validateCtl?.abort();
      validateCtl = null;
      store.setState({ validating: false });
    },

    /** Save draft: creates the record on the first save, then saves new draft revisions. */
    async saveDraft(): Promise<boolean> {
      const s = state();
      const draft = currentDraft(s.editor);
      if (!draft) return false;
      const issues = draftSchemaIssues(draft);
      if (issues.length > 0) {
        notice({
          tone: 'danger',
          message: `Not saved: ${issues.length === 1 ? 'one field has a problem' : `${issues.length} fields have problems`} (see the inspector).`,
        });
        return false;
      }
      const head = s.editor.head;
      const recovery = key();
      if (!head) {
        if (!start('create')) return false;
        const r = await api.createBuilding({ targetId: s.editor.targetId, draft });
        if (!r.ok) {
          fail('create', r.error);
          return false;
        }
        store.dispatch({ type: 'server/success', op: 'create', head: r.data.head, draft: r.data.draft });
        adopt(r.data);
        clearRecovery(recovery, storageOpt);
        notice({
          tone: 'success',
          message: `Saved on the server as a draft (rev ${r.data.head.draftRevision}). Not public until published.`,
        });
        deps.onRecordChange?.(r.data.head.id);
        return true;
      }
      if (!start('save-draft')) return false;
      const r = await api.saveDraft(head.id, { revision: head.revision, draft });
      if (!r.ok) {
        fail('save-draft', r.error);
        return false;
      }
      store.dispatch({ type: 'server/success', op: 'save-draft', head: r.data.head, draft: r.data.draft });
      adopt(r.data);
      if (!shouldGuardUnload(state().editor)) clearRecovery(recovery, storageOpt);
      notice({
        tone: 'success',
        message: `Draft saved on the server (rev ${r.data.head.draftRevision}).${r.data.head.publishedVersion !== null ? ' The public version is unchanged until you publish.' : ''}`,
      });
      return true;
    },

    /** Drops the server draft of a published building (the public version stays). */
    async discardDraft(): Promise<boolean> {
      const head = state().editor.head;
      if (!head || !start('discard-draft')) return false;
      const r = await api.discardDraft(head.id, { revision: head.revision });
      if (!r.ok) {
        fail('discard-draft', r.error);
        return false;
      }
      store.dispatch({
        type: 'server/success',
        op: 'discard-draft',
        head: r.data.head,
        draft: shownDraft(r.data),
      });
      adopt(r.data);
      clearRecovery(key(), storageOpt);
      notice({ tone: 'success', message: 'Draft discarded. The published version is shown again.' });
      return true;
    },

    async publish(changeSummary: string): Promise<boolean> {
      const s = state();
      const head = s.editor.head;
      if (!head) return false;
      const result = currentValidation(s);
      const acknowledgements = (result?.requiredAcknowledgements ?? []).map((code) => ({
        code,
        reason: (s.acknowledgements[code] ?? '').trim(),
      }));
      if (!start('publish')) return false;
      const r = await api.publish(head.id, {
        revision: head.revision,
        acknowledgements,
        changeSummary: changeSummary.trim(),
      });
      if (!r.ok) {
        fail('publish', r.error);
        return false;
      }
      const b = r.data.building;
      store.dispatch({ type: 'server/success', op: 'publish', head: b.head, draft: shownDraft(b) });
      adopt(b);
      clearRecovery(key(), storageOpt);
      notice({
        tone: 'success',
        message: `Published as version ${b.head.publishedVersion ?? '?'} (public data revision ${r.data.publicationVersion}).`,
      });
      deps.onPublicationChange?.();
      return true;
    },

    async archive(reason: string): Promise<boolean> {
      const head = state().editor.head;
      if (!head || !start('archive')) return false;
      const r = await api.archive(head.id, { revision: head.revision, reason: reason.trim() || null });
      if (!r.ok) {
        fail('archive', r.error);
        return false;
      }
      const b = r.data.building;
      store.dispatch({ type: 'server/success', op: 'archive', head: b.head, draft: shownDraft(b) });
      adopt(b);
      notice({
        tone: 'success',
        message: 'Archived: removed from the public map. It can be restored or permanently deleted.',
      });
      deps.onPublicationChange?.();
      return true;
    },

    /** Restore; publication re-validates the last version, so warnings may need acknowledgements. */
    async restore(): Promise<boolean> {
      const s = state();
      const head = s.editor.head;
      if (!head || !start('restore')) return false;
      const acknowledgements = WARNING_CODES.flatMap((code) => {
        const reason = s.acknowledgements[code];
        return validAckReason(reason) ? [{ code, reason: reason.trim() }] : [];
      });
      const r = await api.restore(head.id, { revision: head.revision, acknowledgements });
      if (!r.ok) {
        fail('restore', r.error);
        return false;
      }
      const b = r.data.building;
      store.dispatch({ type: 'server/success', op: 'restore', head: b.head, draft: shownDraft(b) });
      adopt(b);
      notice({
        tone: 'success',
        message:
          b.head.status === 'published'
            ? `Restored: version ${b.head.publishedVersion ?? '?'} is public again.`
            : 'Restored as a draft (it was never published).',
      });
      deps.onPublicationChange?.();
      return true;
    },

    async deleteRecord(confirmId: string): Promise<boolean> {
      const head = state().editor.head;
      if (!head || !start('delete')) return false;
      const recovery = key();
      const r = await api.deleteBuilding(head.id, { revision: head.revision, confirmId });
      if (!r.ok) {
        fail('delete', r.error);
        return false;
      }
      store.dispatch({ type: 'server/success', op: 'delete' });
      clearRecovery(recovery, storageOpt);
      store.setState({ detail: null, baseline: null, validation: null });
      notice({
        tone: 'success',
        message: `Permanently deleted ${r.data.deletedId}. The history keeps a copy (audit event ${r.data.auditEventId}).`,
      });
      deps.onRecordChange?.(null);
      deps.onPublicationChange?.();
      return true;
    },

    async duplicate(): Promise<boolean> {
      const head = state().editor.head;
      if (!head || !start('duplicate')) return false;
      const r = await api.duplicate(head.id, { offsetM: null });
      if (!r.ok) {
        fail('duplicate', r.error);
        return false;
      }
      const draft = shownDraft(r.data);
      store.dispatch({
        type: 'server/success',
        op: 'duplicate',
        head: r.data.head,
        ...(draft ? { draft } : {}),
      });
      adopt(r.data);
      notice({
        tone: 'success',
        message:
          'Duplicated as a new unpublished draft beside the original (no name, unverified, no access point).',
      });
      deps.onRecordChange?.(r.data.head.id);
      return true;
    },

    /**
     * "Apply template vN" preview. On the server (dry run) for a saved,
     * unchanged record; computed locally for a draft with unsaved changes.
     */
    async previewTemplate(
      def: TemplateDefinition,
      variantId: string,
    ): Promise<ApplyTemplatePreview | { error: string }> {
      const s = state();
      const draft = currentDraft(s.editor);
      if (!draft) return { error: 'Nothing is open.' };
      const ref = { templateId: def.id, templateVersion: def.version, variantId };
      const head = s.editor.head;
      if (head && !shouldGuardUnload(s.editor)) {
        if (!start('apply-template')) return { error: 'Another server request is running.' };
        const r = await api.applyTemplate(head.id, { revision: head.revision, ...ref, dryRun: true });
        if (!r.ok) {
          fail('apply-template', r.error);
          return { error: describeError(r.error) };
        }
        store.dispatch({ type: 'server/success', op: 'apply-template' });
        return {
          ref,
          before: draft,
          after: r.data.draft,
          changedFields: r.data.changedFields,
          source: 'server',
          warnings: r.data.validation.issues
            .filter((i) => i.severity !== 'info')
            .map((i) => `${i.severity === 'error' ? 'Error' : 'Warning'}: ${i.message}`),
        };
      }
      const local = applyTemplateVersion(draft, def, variantId);
      if (!local.ok) return { error: local.message };
      return {
        ref,
        before: draft,
        after: local.draft,
        changedFields: local.changedFields,
        source: 'local',
        warnings: local.rangeIssues.map((i) => `Warning: ${i.message}`),
      };
    },

    async applyTemplate(preview: ApplyTemplatePreview): Promise<boolean> {
      const s = state();
      const head = s.editor.head;
      if (preview.source === 'local' || !head) {
        store.dispatch({
          type: 'edit',
          draft: preview.after,
          label: `Apply template ${preview.ref.templateId} v${preview.ref.templateVersion}`,
        });
        notice({ tone: 'info', message: 'Template applied to the local draft. Save the draft to keep it.' });
        return true;
      }
      if (!start('apply-template')) return false;
      const r = await api.applyTemplate(head.id, { revision: head.revision, ...preview.ref, dryRun: false });
      if (!r.ok) {
        fail('apply-template', r.error);
        return false;
      }
      const b = r.data.building;
      store.dispatch({
        type: 'server/success',
        op: 'apply-template',
        ...(b ? { head: b.head } : {}),
        draft: r.data.draft,
      });
      if (b) adopt(b);
      notice({
        tone: 'success',
        message: b ? `Template applied and saved as draft rev ${b.head.draftRevision}.` : 'Template applied.',
      });
      return true;
    },

    /** 409: keep the local changes; re-validate against the server, then overwrite with the new revision. */
    async overwriteAfterConflict(): Promise<boolean> {
      const conflict = state().editor.conflict;
      if (!conflict) return false;
      store.setState(adoptConflictHead(state(), conflict));
      const ok = await actions.validate();
      if (!ok) {
        notice({ tone: 'warning', message: 'The draft could not be re-checked; it was not saved.' });
        return false;
      }
      return actions.saveDraft();
    },

    /** 409: drop the local changes and load the server's current version. */
    async reloadFromServer(): Promise<boolean> {
      const id = state().editor.conflict?.id ?? state().editor.head?.id;
      store.dispatch({ type: 'error/dismiss' });
      if (!id) return false;
      clearRecovery(key(), storageOpt);
      return actions.open(id);
    },

    /** Cancel: drops unsaved local changes (back to the server copy, or closes a never-saved draft). */
    discardLocalChanges(): void {
      const s = state();
      clearRecovery(key(), storageOpt);
      if (s.editor.placement && !s.editor.history) {
        store.dispatch({ type: 'placement/cancel' });
        return;
      }
      if (s.editor.head && s.baseline) {
        store.dispatch({ type: 'record/load', head: s.editor.head, draft: s.baseline });
        notice({ tone: 'info', message: 'Unsaved changes discarded.' });
        return;
      }
      actions.exit();
    },

    /** Leaves the open building: normal map navigation comes back. */
    exit(): void {
      actions.cancelValidation();
      store.dispatch({ type: 'exit' });
      notice(null);
      deps.onRecordChange?.(null);
    },

    /** Dismisses the notice and a shown error (a 409 conflict stays until resolved). */
    dismissNotice(): void {
      notice(null);
      const e = state().editor;
      if (e.lastError && !e.conflict) store.dispatch({ type: 'error/dismiss' });
    },
  };
  return actions;
}
