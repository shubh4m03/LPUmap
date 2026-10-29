/**
 * Approve a suggestion as a public community location. The owner reviews
 * (and may correct) the fields and the position, and must make an explicit
 * access-point choice: a validated path node or none. The server validates
 * the final record again and publishes atomically.
 */
import { useState, type FormEvent } from 'react';
import { useIsMobile } from '../../../accessibility/index.ts';
import { Button } from '../../../components/ui/index.ts';
import type { ApproveResult, SuggestionRecord } from '../../api/schemas.ts';
import { useAdminApi } from '../../context.ts';
import type { CampusDataState } from '../../data/campus-data.ts';
import {
  approveCorrections,
  placeFormFromSuggestion,
  validatePlaceForm,
  type PlaceFormValues,
} from '../../forms/place-form.ts';
import { PlaceFieldsForm } from '../../forms/PlaceFieldsForm.tsx';
import { useAction } from '../../hooks/useAction.ts';
import { accessPointBody, type AccessChoice } from '../../map/access-choice.ts';
import { AccessPointPicker } from '../../map/AccessPointPicker.tsx';
import { useCampusZone } from '../../map/campus-zone.ts';
import { MapPanel } from '../../map/MapPanel.tsx';
import { OutsideCampusNotice } from '../../map/OutsideCampusNotice.tsx';
import { PositionFields } from '../../map/PositionFields.tsx';
import { useAccessCandidates } from '../../map/useAccessCandidates.ts';
import { useAccessMapPick } from '../../map/useAccessMapPick.ts';
import { usePointEditing } from '../../map/usePointEditing.ts';
import { ErrorNotice } from '../../ui/ErrorNotice.tsx';
import { issueFieldErrors, type FieldErrors } from '../../ui/form-errors.ts';
import { Section } from '../../ui/Page.tsx';

export interface ApprovePanelProps {
  suggestion: SuggestionRecord;
  campus: CampusDataState;
  onApproved(result: ApproveResult): void;
  onCancel(): void;
  onReload(): void;
}

export function ApprovePanel({ suggestion, campus, onApproved, onCancel, onReload }: ApprovePanelProps) {
  const api = useAdminApi();
  const mobile = useIsMobile();
  const [values, setValues] = useState<PlaceFormValues>(() => placeFormFromSuggestion(suggestion));
  const [access, setAccess] = useState<AccessChoice>({ kind: 'unset' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [accessError, setAccessError] = useState<string | null>(null);
  const action = useAction();
  const { candidates, note } = useAccessCandidates(campus, values.location);
  const zone = useCampusZone(campus, values.location);

  // Off-campus places are never routable (owner rule), so an access point would have no
  // effect: send "No access point". A moved point invalidates a node chosen for the old position.
  const outside = zone === 'outside';
  const choice: AccessChoice = outside
    ? { kind: 'none' }
    : access.kind === 'node' && candidates && !candidates.some((c) => c.nodeId === access.nodeId)
      ? { kind: 'unset' }
      : access;

  const pick = useAccessMapPick(candidates);
  const { editing, reticleCenter } = usePointEditing({
    point: values.location,
    editable: !action.busy,
    reticle: mobile,
    onPoint: (p) => setValues((v) => ({ ...v, location: p })),
    candidates: candidates ?? undefined,
    selectedNodeId: choice.kind === 'node' ? choice.nodeId : null,
    pickAccess: pick.active ? pick.onMapClick : null,
    pickClick: pick.click,
    handleLabel: 'Drag to move the place',
  });
  const [focus, setFocus] = useState(() => ({ lngLat: suggestion.location, zoom: 18 }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = validatePlaceForm(values);
    const nextErrors: Record<string, string> = v.ok ? {} : { ...v.errors };
    if (suggestion.description && values.description.trim() === '')
      nextErrors.description =
        'The submitted description cannot be removed while approving. Edit the suggestion first to remove it.';
    setErrors(nextErrors);
    if (choice.kind === 'unset') {
      setAccessError('Choose an access point, or “No access point”.');
    } else setAccessError(null);
    if (!v.ok || Object.keys(nextErrors).length > 0 || choice.kind === 'unset') return;
    const fields = approveCorrections(suggestion, v.fields);
    const accessPoint = accessPointBody(choice) ?? undefined;
    const result = await action.run(() =>
      api.community.approveSuggestion(suggestion.id, {
        revision: suggestion.revision,
        ...(fields ? { fields } : {}),
        ...(accessPoint ? { accessPoint } : {}),
      }),
    );
    if (result) onApproved(result);
  };

  const serverErrors = action.error ? issueFieldErrors(action.error.issues) : {};
  const fieldErrors = { ...serverErrors, ...errors };

  return (
    <Section title="Approve and publish">
      <p className="text-sm text-muted">
        Approving creates a public community location with these values. Check them against the evidence; the
        submitter is not contacted.
      </p>
      <form onSubmit={(e) => void submit(e)} className="grid grid-cols-1 gap-4 lg:grid-cols-2" noValidate>
        <div className="flex flex-col gap-4">
          <PlaceFieldsForm values={values} onChange={setValues} errors={fieldErrors} disabled={action.busy} />
        </div>
        <div className="flex flex-col gap-4">
          <MapPanel
            campus={campus}
            editing={editing}
            focus={focus}
            label="Map: position of the place to approve"
            className="h-72 rounded-md border border-border lg:h-80"
          />
          <PositionFields
            value={values.location}
            onChange={(p) => {
              setValues((v) => ({ ...v, location: p }));
              setFocus({ lngLat: p, zoom: 18 });
            }}
            mapCenter={reticleCenter}
            reticle={mobile}
            disabled={action.busy}
            error={fieldErrors.location ?? null}
          />
          {outside ? (
            <p className="text-sm text-muted" data-testid="access-point-off-campus">
              No access point: places outside the campus are not routable, so none is saved.
            </p>
          ) : (
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
              disabled={action.busy}
              error={accessError ?? serverErrors.accessPoint ?? null}
            />
          )}
        </div>
        <div className="flex flex-col gap-3 lg:col-span-2">
          <OutsideCampusNotice zone={zone} />
          {action.error ? (
            <ErrorNotice
              error={action.error}
              title="The suggestion was not approved"
              onReload={
                action.error.kind === 'conflict' || action.error.outcomeUnknown ? onReload : undefined
              }
            />
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={onCancel} disabled={action.busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" icon="check" loading={action.busy}>
              Approve and publish
            </Button>
          </div>
        </div>
      </form>
    </Section>
  );
}
