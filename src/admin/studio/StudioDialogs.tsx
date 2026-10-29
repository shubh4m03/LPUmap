/**
 * Publish (change summary, what changes in public, unresolved warnings with
 * acknowledgements), archive, permanent delete (typed id), discard draft and
 * unsaved-changes confirmations. A dialog closes only after the server
 * confirmed the action; a failure stays in the dialog with the reason.
 */
import { useMemo, useState } from 'react';
import { Badge, Button, Dialog } from '../../components/ui/index.ts';
import { studioPublicLabel } from '../../building-studio/index.ts';
import { STUDIO_LIMITS, type WarningCode } from '../../building-studio/index.ts';
import { prohibitedSourceProblem } from '../../building-studio/ui/index.ts';
import {
  currentValidation,
  missingAcks,
  studioPublishBlockers,
  PUBLISH_BLOCKER_TEXT,
} from '../../building-studio/ui/index.ts';
import { changeList } from '../../building-studio/ui/index.ts';
import { TextField } from './controls.tsx';
import type { StudioDialog } from './StudioToolbar.tsx';
import { useStudioServices, useStudioState } from './studio-context.ts';
import { AckField } from './ValidationPanel.tsx';

export function StudioDialogs({ dialog, onClose }: { dialog: StudioDialog; onClose(): void }) {
  switch (dialog) {
    case 'publish':
      return <PublishDialog onClose={onClose} />;
    case 'archive':
      return <ArchiveDialog onClose={onClose} />;
    case 'delete':
      return <DeleteDialog onClose={onClose} />;
    case 'discard-draft':
      return <DiscardDraftDialog onClose={onClose} />;
    case 'cancel':
    case 'close':
      return <UnsavedDialog mode={dialog} onClose={onClose} />;
    default:
      return null;
  }
}

function ServerError() {
  const error = useStudioState((s) => s.editor.lastError?.message ?? null);
  return error ? (
    <p
      role="alert"
      className="mt-3 rounded-md bg-danger-soft p-2 text-sm text-danger"
      data-testid="studio-dialog-error"
    >
      {error}
    </p>
  ) : null;
}

function PublishDialog({ onClose }: { onClose(): void }) {
  const { actions } = useStudioServices();
  // Arrays get their own (element-wise compared) subscriptions: a fresh array inside an object would re-render forever.
  const blockers = useStudioState(studioPublishBlockers);
  const missing = useStudioState(missingAcks);
  const v = useStudioState((s) => ({
    result: currentValidation(s),
    published: s.detail?.published?.record ?? null,
    draft: s.editor.history?.present ?? null,
    pending: s.editor.pending?.op === 'publish',
    version: s.editor.head?.publishedVersion ?? null,
  }));
  const [summary, setSummary] = useState('');
  const changes = useMemo(() => (v.draft ? changeList(v.published, v.draft) : []), [v.published, v.draft]);
  const summaryProblem =
    prohibitedSourceProblem(summary, 'text') ??
    (summary.trim().length > 0 && summary.trim().length < STUDIO_LIMITS.changeSummary.min
      ? `At least ${STUDIO_LIMITS.changeSummary.min} characters.`
      : null);
  const summaryOk = summary.trim().length >= STUDIO_LIMITS.changeSummary.min && summaryProblem === null;
  const warnings = (v.result?.requiredAcknowledgements ?? []) as WarningCode[];
  const canPublish = blockers.length === 0 && missing.length === 0 && summaryOk;
  const label = v.draft
    ? studioPublicLabel({ verification: v.draft.verification, accuracyClass: 'generic-prefab' })
    : '';
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={v.version ? `Publish version ${v.version + 1}` : 'Publish this building'}
      description="Publishing replaces the public version in every view (3D, isometric, 2D, search and the directory) in one step."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon="globe"
            loading={v.pending}
            disabled={!canPublish}
            data-testid="studio-confirm-publish"
            onClick={() => void actions.publish(summary).then((ok) => ok && onClose())}
          >
            Publish
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {blockers.length > 0 ? (
          <ul className="rounded-md bg-warning-soft p-2 text-sm text-warning">
            {blockers.map((b) => (
              <li key={b}>{PUBLISH_BLOCKER_TEXT[b]}</li>
            ))}
          </ul>
        ) : null}
        <section>
          <h3 className="text-sm font-semibold">What changes in public</h3>
          <ul className="mt-1 list-disc ps-5 text-sm" data-testid="studio-change-list">
            {changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted">
            Shown publicly as “{label}”. Private notes are never published.
          </p>
        </section>
        <section>
          <h3 className="text-sm font-semibold">
            Warnings{' '}
            <Badge tone={missing.length > 0 ? 'warning' : 'success'}>
              {warnings.length === 0
                ? 'none'
                : `${warnings.length - missing.length} of ${warnings.length} acknowledged`}
            </Badge>
          </h3>
          {warnings.length === 0 ? (
            <p className="mt-1 text-sm text-muted">No warnings need an acknowledgement.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-3">
              {warnings.map((code) => (
                <li key={code} className="flex flex-col gap-1">
                  <p className="text-sm">{v.result?.issues.find((i) => i.code === code)?.message ?? code}</p>
                  <AckField code={code} compact />
                </li>
              ))}
            </ul>
          )}
        </section>
        <TextField
          label="Change summary (recorded in the history)"
          multiline
          value={summary}
          maxLength={STUDIO_LIMITS.changeSummary.max}
          error={summaryProblem}
          testId="studio-change-summary"
          onChange={setSummary}
        />
        <ServerError />
      </div>
    </Dialog>
  );
}

function ArchiveDialog({ onClose }: { onClose(): void }) {
  const { actions } = useStudioServices();
  const pending = useStudioState((s) => s.editor.pending?.op === 'archive');
  const [reason, setReason] = useState('');
  return (
    <Dialog
      open
      onClose={onClose}
      title="Archive this building?"
      description="It disappears from the public map and search. The record and its versions are kept; you can restore it or delete it permanently later."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep
          </Button>
          <Button
            variant="danger"
            loading={pending}
            data-testid="studio-confirm-archive"
            onClick={() => void actions.archive(reason).then((ok) => ok && onClose())}
          >
            Archive
          </Button>
        </>
      }
    >
      <TextField
        label="Reason (optional)"
        value={reason}
        maxLength={STUDIO_LIMITS.archiveReason}
        onChange={setReason}
      />
      <ServerError />
    </Dialog>
  );
}

function DeleteDialog({ onClose }: { onClose(): void }) {
  const { actions } = useStudioServices();
  const id = useStudioState((s) => s.editor.head?.id ?? '');
  const pending = useStudioState((s) => s.editor.pending?.op === 'delete');
  const [typed, setTyped] = useState('');
  return (
    <Dialog
      open
      onClose={onClose}
      title="Delete permanently?"
      description="This cannot be undone. The record and all its versions are removed; the history keeps a copy for audit."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep
          </Button>
          <Button
            variant="danger"
            icon="trash"
            loading={pending}
            disabled={typed !== id}
            data-testid="studio-confirm-delete"
            onClick={() => void actions.deleteRecord(typed).then((ok) => ok && onClose())}
          >
            Delete permanently
          </Button>
        </>
      }
    >
      <TextField
        label={`Type the id to confirm: ${id}`}
        value={typed}
        testId="studio-delete-confirm"
        onChange={setTyped}
        error={typed !== '' && typed !== id ? 'The id does not match.' : null}
      />
      <ServerError />
    </Dialog>
  );
}

function DiscardDraftDialog({ onClose }: { onClose(): void }) {
  const { actions } = useStudioServices();
  const pending = useStudioState((s) => s.editor.pending?.op === 'discard-draft');
  return (
    <Dialog
      open
      onClose={onClose}
      title="Discard the server draft?"
      description="The saved draft is deleted and the published version is shown again. The public map does not change."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep draft
          </Button>
          <Button
            variant="danger"
            loading={pending}
            onClick={() => void actions.discardDraft().then((ok) => ok && onClose())}
          >
            Discard draft
          </Button>
        </>
      }
    >
      <ServerError />
    </Dialog>
  );
}

function UnsavedDialog({ mode, onClose }: { mode: 'cancel' | 'close'; onClose(): void }) {
  const { actions } = useStudioServices();
  const onServer = useStudioState((s) => s.editor.head !== null);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Discard unsaved changes?"
      description={
        onServer
          ? 'Your changes since the last save are dropped; the saved draft on the server is kept.'
          : 'This building has never been saved: it is dropped completely.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep editing
          </Button>
          <Button
            variant="danger"
            data-testid="studio-confirm-discard"
            onClick={() => {
              actions.discardLocalChanges();
              if (mode === 'close') actions.exit();
              onClose();
            }}
          >
            {mode === 'close' ? 'Discard and close' : 'Discard changes'}
          </Button>
        </>
      }
    />
  );
}
