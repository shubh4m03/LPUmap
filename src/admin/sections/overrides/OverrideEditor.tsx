/**
 * One base place's override: rename, recategorise, hide, set an owner access
 * point (validated nodes only) and a private note — or, for an orphan, see
 * why it is not applied and delete it deliberately.
 */
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Badge } from '../../../components/ui/index.ts';
import { Button } from '../../../components/ui/index.ts';
import { Spinner } from '../../../components/ui/index.ts';
import { TextInput } from '../../../components/ui/index.ts';
import { useToast } from '../../../components/ui/index.ts';
import { LIMITS } from '../../../community/index.ts';
import type { Place } from '../../../data/index.ts';
import type { OverrideDetail, OverrideView } from '../../api/schemas.ts';
import { useAdminApi } from '../../context.ts';
import { useAdminCampusData } from '../../data/campus-data.ts';
import { useAction } from '../../hooks/useAction.ts';
import { useResource } from '../../hooks/useResource.ts';
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard.ts';
import { accessPointBody, type AccessChoice } from '../../map/access-choice.ts';
import { AccessPointPicker } from '../../map/AccessPointPicker.tsx';
import { MapPanel } from '../../map/MapPanel.tsx';
import { useAccessCandidates } from '../../map/useAccessCandidates.ts';
import { usePointEditing } from '../../map/usePointEditing.ts';
import type { AdminNavigate } from '../../router.ts';
import { adminHref } from '../../routes.ts';
import { ActionDialog } from '../../ui/ActionDialog.tsx';
import { ErrorNotice } from '../../ui/ErrorNotice.tsx';
import { CheckboxField, SelectField, TextArea } from '../../ui/fields.tsx';
import { issueFieldErrors } from '../../ui/form-errors.ts';
import {
  CATEGORY_OPTIONS,
  categoryLabel,
  formatDateTime,
  formatLngLat,
  ORPHAN_GENERAL_ADVICE,
  ORPHAN_REASON_ADVICE,
  ORPHAN_REASON_LABELS,
} from '../../ui/format.ts';
import { Facts, Page, Section } from '../../ui/Page.tsx';
import { onInAppClick } from '../../ui/links.ts';
import {
  overrideForm,
  overridePutBody,
  overrideSummary,
  type OverrideFormValues,
} from './overrides-model.ts';

export function OverrideEditor({
  targetId,
  navigate,
  backHref,
  onBack,
}: {
  targetId: string;
  navigate: AdminNavigate;
  backHref: string;
  onBack(): void;
}) {
  const api = useAdminApi();
  const detail = useResource(`override:${targetId}`, (signal) =>
    api.community.getOverride(targetId, { signal }),
  );
  const back = { href: backHref, label: 'Base-place overrides', onNavigate: onBack };
  const d = detail.state.data;
  if (!d) {
    return (
      <Page title="Base place" back={back}>
        {detail.state.status === 'error' ? (
          <ErrorNotice
            error={detail.state.error}
            title="Could not load this base place"
            onReload={detail.state.error.kind === 'not-found' ? undefined : detail.reload}
          />
        ) : (
          <div className="flex justify-center py-8">
            <Spinner label="Loading…" />
          </div>
        )}
      </Page>
    );
  }
  const historyLink = (
    <a
      className="w-fit text-sm font-medium text-accent-text underline"
      href={adminHref({ section: 'audit', query: { entity: 'override', entityId: targetId } })}
      onClick={onInAppClick(() =>
        navigate({ section: 'audit', query: { entity: 'override', entityId: targetId } }),
      )}
    >
      History of this override
    </a>
  );
  if (!d.place)
    return (
      <OrphanView detail={d} back={back} onReload={detail.reload} onBack={onBack} history={historyLink} />
    );
  return (
    <PlaceOverride
      key={`${targetId}:${d.override?.revision ?? 0}`}
      place={d.place}
      override={d.override}
      back={back}
      history={historyLink}
      onSaved={detail.reload}
      onReload={detail.reload}
    />
  );
}

type Back = { href: string; label: string; onNavigate(): void };

function OrphanView({
  detail,
  back,
  onReload,
  onBack,
  history,
}: {
  detail: OverrideDetail;
  back: Back;
  onReload(): void;
  onBack(): void;
  history: ReactNode;
}) {
  const o = detail.override;
  const [confirm, setConfirm] = useState(false);
  return (
    <Page
      title={o?.baseName ?? detail.targetId}
      back={back}
      description={<Badge tone="warning">Orphaned override: not applied</Badge>}
    >
      <Section title="Why it is not applied">
        {o?.orphanReason ? (
          <>
            <p className="font-medium text-text">{ORPHAN_REASON_LABELS[o.orphanReason]}</p>
            <p className="text-sm text-text">{ORPHAN_REASON_ADVICE[o.orphanReason]}</p>
          </>
        ) : (
          <p className="text-sm text-text">The target is not a campus place in the current dataset.</p>
        )}
        <p className="text-sm text-muted">{ORPHAN_GENERAL_ADVICE}</p>
      </Section>
      {o ? (
        <Section title="Stored override">
          <ul className="list-disc ps-5 text-sm text-text">
            {overrideSummary(o).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <Facts
            items={[
              [
                'Target id',
                <code key="t" className="break-all">
                  {detail.targetId}
                </code>,
              ],
              ['Made on dataset', o.baseDatasetVersion],
              ['Last changed', `${formatDateTime(o.updatedAt)} by ${o.updatedBy} (revision ${o.revision})`],
              ['Private note', o.note],
            ]}
          />
          {history}
          <Button variant="danger" icon="trash" className="w-fit" onClick={() => setConfirm(true)}>
            Delete this orphaned override…
          </Button>
        </Section>
      ) : (
        <p className="text-sm text-muted">There is no override stored for this id.</p>
      )}
      {confirm && o ? (
        <DeleteOverrideDialog
          override={o}
          label={o.baseName ?? detail.targetId}
          orphan
          onClose={() => setConfirm(false)}
          onDone={() => {
            setConfirm(false);
            onBack();
          }}
          onReload={onReload}
        />
      ) : null}
    </Page>
  );
}

function PlaceOverride({
  place,
  override,
  back,
  history,
  onSaved,
  onReload,
}: {
  place: Place;
  override: OverrideView | null;
  back: Back;
  history: ReactNode;
  onSaved(): void;
  onReload(): void;
}) {
  const api = useAdminApi();
  const toast = useToast();
  const campus = useAdminCampusData();
  const initial = useMemo(() => overrideForm(override), [override]);
  const initialAccess: AccessChoice = override?.accessNodeId != null ? { kind: 'keep' } : { kind: 'unset' };
  const [v, setV] = useState<OverrideFormValues>(initial);
  const [access, setAccess] = useState<AccessChoice>(initialAccess);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = useAction();
  const quick = useAction();
  const busy = save.busy || quick.busy;

  const location = override?.fields.location ?? place.location;
  const { candidates, note, problemFor } = useAccessCandidates(campus, location);
  const current =
    override && override.accessNodeId !== null
      ? { nodeId: override.accessNodeId, problem: location ? problemFor(override.accessNodeId) : null }
      : null;
  const dirty =
    v.name !== initial.name ||
    v.categoryId !== initial.categoryId ||
    v.hidden !== initial.hidden ||
    v.note !== initial.note ||
    access.kind === 'node' ||
    access.kind !== initialAccess.kind;
  useUnsavedGuard(dirty);

  const { editing } = usePointEditing({
    point: location,
    editable: false,
    reticle: false,
    candidates: candidates ?? undefined,
    selectedNodeId:
      access.kind === 'node'
        ? access.nodeId
        : access.kind === 'keep'
          ? (override?.accessNodeId ?? null)
          : null,
  });
  const focus = useMemo(() => (location ? { lngLat: location, zoom: 18 } : null), [location]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    let ap = accessPointBody(access);
    if (ap === null && !current) ap = undefined; // "base routing" when there is no owner node: nothing to clear
    const body = overridePutBody(place, override, v, ap);
    const r = await save.run(() => api.community.putOverride(place.id, body));
    if (r) {
      toast.show({
        message: r.override
          ? 'Override saved and published.'
          : 'Nothing differs from the base data: no override is stored.',
        tone: 'success',
      });
      onSaved();
    }
  };

  const toggleHidden = async () => {
    const r = await quick.run(() =>
      override?.hidden
        ? api.community.unhideOverride(place.id, { revision: override.revision })
        : api.community.hideOverride(place.id, { revision: override?.revision ?? null }),
    );
    if (r) {
      toast.show({
        message: override?.hidden ? 'The place is shown again.' : 'The place is hidden from the public map.',
        tone: 'success',
      });
      onSaved();
    }
  };

  const serverErrors = save.error ? issueFieldErrors(save.error.issues) : {};
  const baseCategoryAssignable = CATEGORY_OPTIONS.some((c) => c.value === place.categoryId);

  return (
    <Page
      title={place.displayName}
      back={back}
      wide
      description={
        <span className="flex flex-wrap items-center gap-2">
          <code className="break-all">{place.id}</code>
          {override ? <Badge tone="accent">Has an override</Badge> : <Badge>Base values</Badge>}
          {override?.hidden ? <Badge tone="warning">Hidden</Badge> : null}
          {dirty ? <Badge tone="info">Unsaved changes</Badge> : null}
        </span>
      }
      actions={
        <Button
          icon={override?.hidden ? 'reset' : 'close'}
          loading={quick.busy}
          disabled={save.busy}
          onClick={() => void toggleHidden()}
        >
          {override?.hidden ? 'Show again' : 'Hide from the public map'}
        </Button>
      }
    >
      {quick.error ? (
        <ErrorNotice error={quick.error} title="The change was not applied" onReload={onReload} />
      ) : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Base data (read-only)">
          <Facts
            items={[
              ['Name', place.name ?? 'No name in the source data'],
              ['Category', categoryLabel(place.categoryId)],
              ['Position', place.location ? formatLngLat(place.location) : 'No dependable position'],
              [
                'Source',
                `${place.provenance.sourceId}${place.provenance.sourceRef ? ` · ${place.provenance.sourceRef}` : ''}`,
              ],
            ]}
          />
          {override ? (
            <Facts
              items={[
                ['Override made on', override.baseDatasetVersion],
                [
                  'Last changed',
                  `${formatDateTime(override.updatedAt)} by ${override.updatedBy} (revision ${override.revision})`,
                ],
              ]}
            />
          ) : null}
          {history}
        </Section>
        <MapPanel
          campus={campus}
          editing={editing}
          focus={focus}
          label={`Map: ${place.displayName}`}
          className="h-64 rounded-lg border border-border lg:h-auto lg:min-h-64"
        />
      </div>
      <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
        <Section title="Owner changes">
          <TextInput
            label="Name"
            hint={
              place.name
                ? `Leave empty to keep “${place.name}”.`
                : 'The source has no name. Leave empty to keep it unnamed.'
            }
            maxLength={LIMITS.name.max}
            value={v.name}
            onChange={(e) => setV({ ...v, name: e.target.value })}
            error={serverErrors.name}
            disabled={busy}
          />
          <SelectField
            label="Category"
            value={v.categoryId}
            onChange={(e) => setV({ ...v, categoryId: e.target.value })}
            options={[
              { value: '', label: `Keep the base category (${categoryLabel(place.categoryId)})` },
              ...CATEGORY_OPTIONS.filter((c) => !baseCategoryAssignable || c.value !== place.categoryId),
            ]}
            error={serverErrors.categoryId}
            disabled={busy}
          />
          <CheckboxField
            label="Hidden from the public map"
            hint="Hidden places disappear from the map, search and routing. Reversible."
            checked={v.hidden}
            onChange={(hidden) => setV({ ...v, hidden })}
            disabled={busy}
          />
          {location ? (
            <AccessPointPicker
              location={location}
              candidates={candidates}
              candidatesNote={note}
              value={access}
              onChange={setAccess}
              current={current}
              disabled={busy}
              noneLabel="Use the base data's own routing"
              noneDetail={current ? 'Removes the owner access point.' : 'No change.'}
              error={serverErrors.accessPoint ?? null}
            />
          ) : (
            <p className="text-sm text-muted">
              This place has no dependable position, so it cannot have an access point.
            </p>
          )}
          <TextArea
            label="Private note (optional)"
            hint="Only visible in the admin."
            maxLength={LIMITS.note}
            value={v.note}
            onChange={(e) => setV({ ...v, note: e.target.value })}
            disabled={busy}
          />
          {save.error ? (
            <ErrorNotice
              error={save.error}
              title="The override was not saved"
              onReload={save.error.kind === 'conflict' || save.error.outcomeUnknown ? onReload : undefined}
            />
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            {override ? (
              <Button variant="ghost" icon="reset" disabled={busy} onClick={() => setConfirmDelete(true)}>
                Back to base values…
              </Button>
            ) : null}
            <Button
              type="submit"
              variant="primary"
              icon="check"
              loading={save.busy}
              disabled={quick.busy || !dirty}
            >
              Save override
            </Button>
          </div>
        </Section>
      </form>
      {confirmDelete && override ? (
        <DeleteOverrideDialog
          override={override}
          label={place.displayName}
          onClose={() => setConfirmDelete(false)}
          onDone={() => {
            setConfirmDelete(false);
            toast.show({ message: 'The base values apply again.', tone: 'success' });
            onSaved();
          }}
          onReload={onReload}
        />
      ) : null}
    </Page>
  );
}

function DeleteOverrideDialog({
  override,
  label,
  orphan = false,
  onClose,
  onDone,
  onReload,
}: {
  override: OverrideView;
  label: string;
  orphan?: boolean;
  onClose(): void;
  onDone(): void;
  onReload(): void;
}) {
  const api = useAdminApi();
  const action = useAction();
  return (
    <ActionDialog
      open
      title={orphan ? 'Delete this orphaned override?' : 'Return to the base values?'}
      description={
        orphan
          ? `${ORPHAN_GENERAL_ADVICE} The history keeps a copy, and the change can be reverted from History.`
          : `Removes every owner change to “${label}” (name, category, hidden, access point, note). The history keeps a copy and the change can be reverted from History.`
      }
      confirmLabel={orphan ? 'Delete override' : 'Return to base values'}
      danger
      busy={action.busy}
      error={action.error}
      errorTitle="Nothing was removed"
      onReload={onReload}
      onClose={onClose}
      onConfirm={async () => {
        const r = await action.run(() =>
          api.community.deleteOverride(override.targetId, { revision: override.revision }),
        );
        if (r) onDone();
      }}
    />
  );
}
