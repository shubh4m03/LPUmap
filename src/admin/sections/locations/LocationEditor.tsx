/**
 * Create or edit one owner/community location on the map: fields, position
 * (click / drag on desktop, centre pin on phones, or typed coordinates),
 * access point (validated nodes only), hide / restore, and permanent delete
 * of hidden locations with a typed confirmation.
 */
import { useMemo, useState, type FormEvent } from 'react';
import { useIsMobile } from '../../../accessibility/index.ts';
import { Badge } from '../../../components/ui/index.ts';
import { Button } from '../../../components/ui/index.ts';
import { cx, FOCUS_RING } from '../../../components/ui/index.ts';
import { TextInput } from '../../../components/ui/index.ts';
import { useToast } from '../../../components/ui/index.ts';
import type { LngLat } from '../../../data/index.ts';
import type { LocationRecord } from '../../api/schemas.ts';
import { useAdminApi } from '../../context.ts';
import type { CampusDataState } from '../../data/campus-data.ts';
import {
  emptyPlaceForm,
  locationPatch,
  placeFormDirty,
  placeFormFromLocation,
  validatePlaceForm,
  type PlaceFormValues,
} from '../../forms/place-form.ts';
import { PlaceFieldsForm } from '../../forms/PlaceFieldsForm.tsx';
import { useAction } from '../../hooks/useAction.ts';
import { UNSAVED_CONFIRM, useUnsavedGuard } from '../../hooks/useUnsavedGuard.ts';
import { accessPointBody, type AccessChoice } from '../../map/access-choice.ts';
import { AccessPointPicker } from '../../map/AccessPointPicker.tsx';
import { useCampusZone } from '../../map/campus-zone.ts';
import { MapPanel } from '../../map/MapPanel.tsx';
import { OutsideCampusNotice } from '../../map/OutsideCampusNotice.tsx';
import { PositionFields } from '../../map/PositionFields.tsx';
import { useAccessCandidates } from '../../map/useAccessCandidates.ts';
import { useAccessMapPick } from '../../map/useAccessMapPick.ts';
import { usePointEditing } from '../../map/usePointEditing.ts';
import type { AdminNavigate } from '../../router.ts';
import { adminHref } from '../../routes.ts';
import { ActionDialog } from '../../ui/ActionDialog.tsx';
import { ErrorNotice } from '../../ui/ErrorNotice.tsx';
import { issueFieldErrors, type FieldErrors } from '../../ui/form-errors.ts';
import { formatDateTime } from '../../ui/format.ts';
import { Facts } from '../../ui/Page.tsx';
import { onInAppClick } from '../../ui/links.ts';
import { SplitLayout } from '../../ui/SplitLayout.tsx';

export interface LocationEditorProps {
  /** null = a new owner location. */
  record: LocationRecord | null;
  others: readonly LocationRecord[];
  campus: CampusDataState;
  navigate: AdminNavigate;
  backHref: string;
  onBack(): void;
  /** A write succeeded: the server's current record (null after a delete). */
  onSaved(record: LocationRecord | null, removedId?: string): void;
  onReload(): void;
}

function initialAccess(record: LocationRecord | null): AccessChoice {
  if (!record) return { kind: 'unset' };
  return record.accessNodeId !== null ? { kind: 'keep' } : { kind: 'none' };
}

export function LocationEditor({
  record,
  others,
  campus,
  navigate,
  backHref,
  onBack,
  onSaved,
  onReload,
}: LocationEditorProps) {
  const api = useAdminApi();
  const toast = useToast();
  const mobile = useIsMobile();
  const initial = useMemo(() => (record ? placeFormFromLocation(record) : emptyPlaceForm()), [record]);
  const [values, setValues] = useState<PlaceFormValues>(initial);
  const [access, setAccess] = useState<AccessChoice>(() => initialAccess(record));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [accessError, setAccessError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = useAction();
  const status = useAction();
  const busy = save.busy || status.busy;

  const { candidates, note, problemFor } = useAccessCandidates(campus, values.location);
  const zone = useCampusZone(campus, values.location);
  const current =
    record && record.accessNodeId !== null
      ? { nodeId: record.accessNodeId, problem: values.location ? problemFor(record.accessNodeId) : null }
      : null;
  const choice: AccessChoice =
    access.kind === 'node' && candidates && !candidates.some((c) => c.nodeId === access.nodeId)
      ? { kind: 'unset' }
      : access;

  const dirty =
    placeFormDirty(values, initial) || JSON.stringify(choice) !== JSON.stringify(initialAccess(record));
  useUnsavedGuard(dirty);

  const otherPoints = useMemo(
    () => others.filter((o) => o.id !== record?.id).map((o) => ({ id: o.id, position: o.location })),
    [others, record?.id],
  );
  const setPoint = (p: LngLat) => setValues((v) => ({ ...v, location: p }));
  const pick = useAccessMapPick(candidates);
  const { editing, reticleCenter } = usePointEditing({
    point: values.location,
    editable: !busy,
    reticle: mobile,
    onPoint: setPoint,
    others: otherPoints,
    candidates: candidates ?? undefined,
    selectedNodeId:
      choice.kind === 'node' ? choice.nodeId : choice.kind === 'keep' ? record?.accessNodeId : null,
    pickAccess: pick.active ? pick.onMapClick : null,
    pickClick: pick.click,
    handleLabel: 'Drag to move the location',
  });
  // The camera follows positions set from the form (typed, centre pin, steps); map clicks/drags are already in view.
  const [focus, setFocus] = useState<{ lngLat: LngLat; zoom: number } | null>(() =>
    record ? { lngLat: record.location, zoom: 18 } : null,
  );

  const leave = () => {
    if (dirty && !window.confirm(UNSAVED_CONFIRM)) return;
    onBack();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = validatePlaceForm(values);
    setErrors(v.ok ? {} : v.errors);
    let aErr: string | null = null;
    if (choice.kind === 'unset') aErr = 'Choose an access point, or “No access point”.';
    else if (choice.kind === 'keep' && current?.problem)
      aErr = 'The current access point is not valid at the new position. Choose another one or remove it.';
    setAccessError(aErr);
    if (!v.ok || aErr) return;
    const ap = accessPointBody(choice);
    if (!record) {
      const created = await save.run(() =>
        api.community.createLocation({ fields: v.fields, ...(ap ? { accessPoint: ap } : {}) }),
      );
      if (created) {
        toast.show({ message: `Location “${created.name}” created and published.`, tone: 'success' });
        onSaved(created);
        navigate({ section: 'locations', id: created.id }, { replace: true });
      }
      return;
    }
    const fields = locationPatch(record, v.fields);
    const accessPoint = ap === null && record.accessNodeId === null ? undefined : ap;
    if (Object.keys(fields).length === 0 && accessPoint === undefined) {
      toast.show({ message: 'Nothing to save: no field was changed.' });
      return;
    }
    const updated = await save.run(() =>
      api.community.updateLocation(record.id, {
        revision: record.revision,
        fields,
        ...(accessPoint !== undefined ? { accessPoint } : {}),
      }),
    );
    if (updated) {
      toast.show({ message: 'Changes saved.', tone: 'success' });
      onSaved(updated);
    }
  };

  const setVisibility = async (hide: boolean) => {
    if (!record) return;
    const r = await status.run(() =>
      hide
        ? api.community.hideLocation(record.id, { revision: record.revision })
        : api.community.restoreLocation(record.id, { revision: record.revision }),
    );
    if (r) {
      toast.show({
        message: hide ? 'Location hidden from the public map.' : 'Location restored to the public map.',
        tone: 'success',
      });
      onSaved(r);
    }
  };

  const serverErrors = save.error ? issueFieldErrors(save.error.issues) : {};
  const fieldErrors = { ...serverErrors, ...errors };
  const title = record ? record.name : 'New location';

  const panel = (
    <>
      <a
        href={backHref}
        onClick={onInAppClick(leave)}
        className={cx(
          'inline-flex min-h-10 w-fit items-center rounded-md text-sm font-medium text-accent-text hover:underline',
          FOCUS_RING,
        )}
      >
        ‹ All locations
      </a>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold break-words text-text">{title}</h1>
        {record ? (
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <Badge tone={record.status === 'active' ? 'success' : 'neutral'}>
              {record.status === 'active' ? 'Published' : 'Hidden'}
            </Badge>
            <Badge>{record.origin === 'owner' ? 'Owner location' : 'Community location'}</Badge>
            {record.accessNodeId === null ? <Badge tone="warning">Not routable</Badge> : null}
            {dirty ? <Badge tone="info">Unsaved changes</Badge> : null}
          </p>
        ) : (
          <p className="text-sm text-muted">
            A new owner location is published as soon as it is saved. Place it on the map first.
          </p>
        )}
      </div>
      {status.error ? (
        <ErrorNotice error={status.error} title="The status was not changed" onReload={onReload} />
      ) : null}
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-5" noValidate>
        <PositionFields
          value={values.location}
          onChange={(p) => {
            setPoint(p);
            setFocus({ lngLat: p, zoom: 18 });
          }}
          mapCenter={reticleCenter}
          reticle={mobile}
          disabled={busy}
          error={fieldErrors.location ?? null}
        />
        <OutsideCampusNotice zone={zone} />
        <PlaceFieldsForm values={values} onChange={setValues} errors={fieldErrors} disabled={busy} />
        <AccessPointPicker
          location={values.location}
          mapPick={pick}
          candidates={candidates}
          candidatesNote={note}
          value={choice}
          onChange={(c) => {
            setAccess(c);
            setAccessError(null);
          }}
          current={current}
          disabled={busy}
          error={accessError ?? serverErrors.accessPoint ?? null}
        />
        {save.error ? (
          <ErrorNotice
            error={save.error}
            title={record ? 'The changes were not saved' : 'The location was not created'}
            onReload={save.error.kind === 'conflict' || save.error.outcomeUnknown ? onReload : undefined}
          />
        ) : null}
        <div className="sticky bottom-0 -mx-4 lg:-bottom-4 flex flex-wrap justify-end gap-2 border-t border-border bg-surface px-4 py-3">
          <Button
            variant="ghost"
            size="lg"
            disabled={busy || !dirty}
            onClick={() => {
              setValues(initial);
              setAccess(initialAccess(record));
              setErrors({});
              setAccessError(null);
              save.clear();
            }}
          >
            Discard changes
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            icon="check"
            loading={save.busy}
            disabled={status.busy}
          >
            {record ? 'Save' : 'Create and publish'}
          </Button>
        </div>
      </form>
      {record ? (
        <section
          aria-label="Visibility and deletion"
          className="flex flex-col gap-3 border-t border-border pt-4"
        >
          <h2 className="text-base font-semibold text-text">Visibility</h2>
          {record.status === 'active' ? (
            <>
              <p className="text-sm text-muted">
                Hiding removes it from the public map. You can restore it later.
              </p>
              <Button
                className="w-fit"
                icon="close"
                loading={status.busy}
                onClick={() => void setVisibility(true)}
              >
                Hide from the public map
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">
                Hidden: not on the public map. Restore it, or delete it permanently.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button icon="reset" loading={status.busy} onClick={() => void setVisibility(false)}>
                  Restore to the public map
                </Button>
                <Button
                  variant="danger"
                  icon="trash"
                  disabled={status.busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete permanently…
                </Button>
              </div>
            </>
          )}
          <Facts
            items={[
              [
                'Id',
                <code key="id" className="break-all">
                  {record.id}
                </code>,
              ],
              [
                'From suggestion',
                record.suggestionId ? (
                  <a
                    key="s"
                    className={cx('break-all text-accent-text underline', FOCUS_RING)}
                    href={adminHref({ section: 'queue', id: record.suggestionId })}
                    onClick={onInAppClick(() => navigate({ section: 'queue', id: record.suggestionId }))}
                  >
                    {record.suggestionId}
                  </a>
                ) : null,
              ],
              ['Created', `${formatDateTime(record.createdAt)} by ${record.createdBy}`],
              [
                'Last changed',
                `${formatDateTime(record.updatedAt)} by ${record.updatedBy} (revision ${record.revision})`,
              ],
            ]}
          />
          <a
            className={cx('w-fit text-sm font-medium text-accent-text underline', FOCUS_RING)}
            href={adminHref({ section: 'audit', query: { entity: 'location', entityId: record.id } })}
            onClick={onInAppClick(() =>
              navigate({ section: 'audit', query: { entity: 'location', entityId: record.id } }),
            )}
          >
            History of this location
          </a>
        </section>
      ) : null}
      {confirmDelete && record ? (
        <DeleteLocationDialog
          record={record}
          onClose={() => setConfirmDelete(false)}
          onDeleted={() => {
            setConfirmDelete(false);
            toast.show({ message: `“${record.name}” was deleted permanently.`, tone: 'success' });
            onSaved(null, record.id);
            onBack();
          }}
          onReload={onReload}
        />
      ) : null}
    </>
  );

  return (
    <SplitLayout
      mapFirst
      panel={panel}
      map={
        <MapPanel
          campus={campus}
          editing={editing}
          focus={focus}
          label={record ? `Map: position of ${record.name}` : 'Map: place the new location'}
          className="h-full"
        />
      }
    />
  );
}

function DeleteLocationDialog({
  record,
  onClose,
  onDeleted,
  onReload,
}: {
  record: LocationRecord;
  onClose(): void;
  onDeleted(): void;
  onReload(): void;
}) {
  const api = useAdminApi();
  const action = useAction();
  const [typed, setTyped] = useState('');
  const matches = typed === record.name;
  return (
    <ActionDialog
      open
      title="Delete this location permanently?"
      description="This cannot be undone from the admin. The history keeps a copy of its last values."
      confirmLabel="Delete permanently"
      danger
      busy={action.busy}
      canConfirm={matches}
      error={action.error}
      errorTitle="The location was not deleted"
      onReload={onReload}
      onClose={onClose}
      onConfirm={async () => {
        const r = await action.run(() =>
          api.community.deleteLocation(record.id, { revision: record.revision, confirmName: typed }),
        );
        if (r) onDeleted();
      }}
    >
      <TextInput
        label={`Type the name to confirm: ${record.name}`}
        autoComplete="off"
        spellCheck={false}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        error={typed.length > 0 && !matches ? 'The name does not match.' : undefined}
      />
    </ActionDialog>
  );
}
