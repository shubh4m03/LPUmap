/**
 * Moderation dialogs: reject (private reason), request information (private
 * note; nobody is contacted), mark as duplicate (of an existing record id),
 * reopen, and edit before approval. Each sends the revision it was opened
 * with; a conflict shows the server's message and offers a reload.
 */
import { useState } from 'react';
import { LIMITS } from '../../../community/index.ts';
import { TextInput } from '../../../components/ui/index.ts';
import type { SuggestionRecord } from '../../api/schemas.ts';
import { useAdminApi } from '../../context.ts';
import { useAction } from '../../hooks/useAction.ts';
import { ActionDialog } from '../../ui/ActionDialog.tsx';
import { SelectField, TextArea } from '../../ui/fields.tsx';
import { issueFieldErrors, type FieldErrors } from '../../ui/form-errors.ts';
import { CATEGORY_OPTIONS } from '../../ui/format.ts';
import { suggestionEditBody, type SuggestionEditValues } from './suggestion-edit.ts';

export interface ModerationDialogProps {
  suggestion: SuggestionRecord;
  onClose(): void;
  onDone(record: SuggestionRecord, message: string): void;
  onReload(): void;
}

export function RejectDialog({ suggestion, onClose, onDone, onReload }: ModerationDialogProps) {
  const api = useAdminApi();
  const action = useAction();
  const [reason, setReason] = useState('');
  return (
    <ActionDialog
      open
      title="Reject this suggestion"
      description="It stays in the records as rejected and can be reopened later. The submitter is not notified."
      confirmLabel="Reject"
      danger
      busy={action.busy}
      error={action.error}
      errorTitle="The suggestion was not rejected"
      onReload={onReload}
      onClose={onClose}
      onConfirm={async () => {
        const r = await action.run(() =>
          api.community.rejectSuggestion(suggestion.id, {
            revision: suggestion.revision,
            ...(reason.trim() ? { reason: reason.trim() } : {}),
          }),
        );
        if (r) onDone(r, 'Suggestion rejected.');
      }}
    >
      <TextArea
        label="Reason (optional, private)"
        hint="Only visible in the admin."
        maxLength={LIMITS.note}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
    </ActionDialog>
  );
}

export function RequestInfoDialog({ suggestion, onClose, onDone, onReload }: ModerationDialogProps) {
  const api = useAdminApi();
  const action = useAction();
  const [note, setNote] = useState('');
  return (
    <ActionDialog
      open
      title="Mark as needing information"
      description="This only records that more information is needed. No email or message is sent: the submitter is not contacted and cannot see this note."
      confirmLabel="Mark as needing information"
      busy={action.busy}
      error={action.error}
      errorTitle="The status was not changed"
      onReload={onReload}
      onClose={onClose}
      onConfirm={async () => {
        const r = await action.run(() =>
          api.community.requestInformation(suggestion.id, {
            revision: suggestion.revision,
            ...(note.trim() ? { note: note.trim() } : {}),
          }),
        );
        if (r) onDone(r, 'Marked as needing information. Nobody was contacted.');
      }}
    >
      <TextArea
        label="What is missing? (optional, private)"
        maxLength={LIMITS.note}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
    </ActionDialog>
  );
}

export function DuplicateDialog({
  suggestion,
  initialTarget,
  onClose,
  onDone,
  onReload,
}: ModerationDialogProps & { initialTarget: string }) {
  const api = useAdminApi();
  const action = useAction();
  const [target, setTarget] = useState(initialTarget);
  const trimmed = target.trim();
  return (
    <ActionDialog
      open
      title="Mark as a duplicate"
      description="Use this when the place already exists. It is not published; it can be reopened later."
      confirmLabel="Mark as duplicate"
      busy={action.busy}
      canConfirm={trimmed.length > 0 && trimmed !== suggestion.id}
      error={action.error}
      errorTitle="The suggestion was not marked as a duplicate"
      onReload={onReload}
      onClose={onClose}
      onConfirm={async () => {
        const r = await action.run(() =>
          api.community.markDuplicate(suggestion.id, { revision: suggestion.revision, duplicateOf: trimmed }),
        );
        if (r) onDone(r, `Marked as a duplicate of ${trimmed}.`);
      }}
    >
      <TextInput
        label="Duplicate of (record id)"
        hint="An existing base place id (osm:…, cur:…), location id (own:…, com:…) or suggestion id (sug_…). The server checks that it exists."
        autoComplete="off"
        spellCheck={false}
        maxLength={200}
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        error={trimmed === suggestion.id ? 'A suggestion cannot duplicate itself.' : undefined}
      />
    </ActionDialog>
  );
}

export function ReopenDialog({ suggestion, onClose, onDone, onReload }: ModerationDialogProps) {
  const api = useAdminApi();
  const action = useAction();
  return (
    <ActionDialog
      open
      title="Reopen this suggestion"
      description="It goes back to the pending queue for a new decision."
      confirmLabel="Reopen"
      busy={action.busy}
      error={action.error}
      errorTitle="The suggestion was not reopened"
      onReload={onReload}
      onClose={onClose}
      onConfirm={async () => {
        const r = await action.run(() =>
          api.community.reopenSuggestion(suggestion.id, { revision: suggestion.revision }),
        );
        if (r) onDone(r, 'Suggestion reopened.');
      }}
    />
  );
}

export function EditSuggestionDialog({ suggestion: s, onClose, onDone, onReload }: ModerationDialogProps) {
  const api = useAdminApi();
  const action = useAction();
  const [v, setV] = useState<SuggestionEditValues>({
    name: s.name,
    categoryId: s.categoryId,
    lat: String(s.location[1]),
    lon: String(s.location[0]),
    description: s.description ?? '',
    landmark: s.landmark ?? '',
    evidenceUrl: s.evidenceUrl ?? '',
    details: s.details ?? '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = (k: keyof SuggestionEditValues, value: string) => setV((cur) => ({ ...cur, [k]: value }));
  const server = action.error ? issueFieldErrors(action.error.issues) : {};
  const e = { ...server, ...errors };
  return (
    <ActionDialog
      open
      title="Edit the suggestion"
      description="Correct the submission before deciding. The original values stay in the history."
      confirmLabel="Save changes"
      busy={action.busy}
      error={action.error}
      errorTitle="The changes were not saved"
      onReload={onReload}
      onClose={onClose}
      onConfirm={async () => {
        const built = suggestionEditBody(s, v);
        if (!built.ok) {
          setErrors(built.errors);
          return;
        }
        setErrors({});
        if (Object.keys(built.body.fields).length === 0) {
          onClose();
          return;
        }
        const r = await action.run(() => api.community.editSuggestion(s.id, built.body));
        if (r) onDone(r, 'Suggestion updated.');
      }}
    >
      <TextInput
        label="Name"
        value={v.name}
        maxLength={LIMITS.name.max}
        onChange={(x) => set('name', x.target.value)}
        error={e.name}
      />
      <SelectField
        label="Category"
        value={v.categoryId}
        onChange={(x) => set('categoryId', x.target.value)}
        options={CATEGORY_OPTIONS}
        error={e.categoryId}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextInput
          label="Latitude"
          inputMode="decimal"
          value={v.lat}
          onChange={(x) => set('lat', x.target.value)}
        />
        <TextInput
          label="Longitude"
          inputMode="decimal"
          value={v.lon}
          onChange={(x) => set('lon', x.target.value)}
        />
      </div>
      {e.location ? (
        <p role="alert" className="text-sm text-danger">
          {e.location}
        </p>
      ) : null}
      <TextArea
        label="Description"
        maxLength={LIMITS.description}
        value={v.description}
        onChange={(x) => set('description', x.target.value)}
        error={e.description}
      />
      <TextInput
        label="Landmark"
        maxLength={LIMITS.landmark}
        value={v.landmark}
        onChange={(x) => set('landmark', x.target.value)}
        error={e.landmark}
      />
      <TextInput
        label="Evidence link"
        type="url"
        maxLength={LIMITS.url}
        value={v.evidenceUrl}
        onChange={(x) => set('evidenceUrl', x.target.value)}
        error={e.evidenceUrl}
      />
      <TextArea
        label="Other details"
        maxLength={LIMITS.details}
        value={v.details}
        onChange={(x) => set('details', x.target.value)}
        error={e.details}
      />
    </ActionDialog>
  );
}
