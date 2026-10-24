/**
 * Messages over the Studio map: the last server result (success says what
 * the server confirmed; failure says what is known), a 409 conflict with the
 * server's current head and the two honest ways out, and the crash-recovery
 * offer for unsaved changes found in this browser.
 */
import { useEffect, type ReactNode } from 'react';
import { Button, Icon } from '../../components/ui/index.ts';
import { cx } from '../../components/ui/cx.ts';
import { LOCAL_RECOVERY_LABEL } from '../../building-studio/local-recovery.ts';
import { useStudioServices, useStudioState } from './studio-context.ts';

/** How long a confirmation stays before it fades. */
export const NOTICE_MS = 10_000;

const TONE = {
  success: 'border-success bg-success-soft text-success',
  info: 'border-info bg-info-soft text-info',
  warning: 'border-warning bg-warning-soft text-warning',
  danger: 'border-danger bg-danger-soft text-danger',
} as const;

function Banner(props: {
  tone: keyof typeof TONE;
  role?: 'status' | 'alert';
  children: ReactNode;
  actions?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      role={props.role ?? 'status'}
      data-testid={props.testId}
      className={cx(
        'flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2 text-sm',
        TONE[props.tone],
      )}
    >
      <div className="flex min-w-60 flex-1 items-start gap-2">
        <Icon
          name={props.tone === 'success' ? 'check' : props.tone === 'info' ? 'info' : 'warning'}
          size={18}
          className="mt-px shrink-0"
        />
        <div className="min-w-0 flex-1 text-text">{props.children}</div>
      </div>
      {props.actions ? <div className="ms-auto flex flex-wrap justify-end gap-2">{props.actions}</div> : null}
    </div>
  );
}

/** A strip above the map (never covering it); renders nothing when there is nothing to say. */
export function StudioBanners({ note }: { note: string | null }) {
  const { actions, store } = useStudioServices();
  const v = useStudioState((s) => ({
    notice: s.notice,
    error: s.editor.lastError,
    conflict: s.editor.conflict,
    recovery: s.recovery,
    headRevision: s.editor.head?.revision ?? null,
    pending: s.editor.pending !== null,
  }));
  // Confirmations fade after a while (the state badge keeps saying where things stand); problems stay.
  const transient = v.notice && (v.notice.tone === 'info' || v.notice.tone === 'success') ? v.notice : null;
  useEffect(() => {
    if (!transient) return;
    const t = setTimeout(() => {
      if (store.getState().notice === transient) store.setState({ notice: null });
    }, NOTICE_MS);
    return () => clearTimeout(t);
  }, [transient, store]);
  if (!v.conflict && !v.error && !v.notice && !v.recovery && !note) return null;
  return (
    <div className="flex shrink-0 flex-col items-center gap-2 border-b border-border bg-surface p-2">
      <div className="flex w-full max-w-2xl flex-col gap-2">
        {v.conflict ? (
          <Banner
            tone="warning"
            role="alert"
            testId="studio-conflict"
            actions={
              <>
                <Button size="sm" disabled={v.pending} onClick={() => void actions.reloadFromServer()}>
                  Load the server version (drop my changes)
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={v.pending}
                  onClick={() => void actions.overwriteAfterConflict()}
                >
                  Re-check and save mine over it
                </Button>
              </>
            }
          >
            <p className="font-medium">This building was changed elsewhere.</p>
            <p className="text-xs">
              The server now has revision {v.conflict.revision} ({v.conflict.status}
              {v.conflict.hasDraft ? `, draft rev ${v.conflict.draftRevision}` : ''}
              {v.conflict.publishedVersion !== null ? `, published v${v.conflict.publishedVersion}` : ''}),
              updated by {v.conflict.updatedBy} at {new Date(v.conflict.updatedAt).toLocaleString()}. Your
              changes are kept here and were not saved.
            </p>
          </Banner>
        ) : v.error ? (
          <Banner
            tone="danger"
            role="alert"
            testId="studio-error"
            actions={
              <Button size="sm" variant="ghost" onClick={() => actions.dismissNotice()}>
                Dismiss
              </Button>
            }
          >
            <p className="font-medium">{FAILED[v.error.op] ?? 'The request failed.'}</p>
            <p className="text-xs">{v.error.message}</p>
            {v.error.op !== 'load' ? (
              <p className="text-xs">
                Your local draft is kept{v.error.retryable ? '; you can try again.' : '.'}
              </p>
            ) : null}
          </Banner>
        ) : v.notice ? (
          <Banner
            tone={v.notice.tone}
            testId="studio-notice"
            actions={
              <Button size="sm" variant="ghost" onClick={() => actions.dismissNotice()}>
                Dismiss
              </Button>
            }
          >
            {v.notice.message}
          </Banner>
        ) : null}
        {v.recovery ? (
          <Banner
            tone="info"
            role="alert"
            testId="studio-recovery"
            actions={
              <>
                <Button size="sm" variant="ghost" onClick={() => actions.dismissRecovery()}>
                  Discard them
                </Button>
                <Button size="sm" variant="primary" onClick={() => actions.restoreRecovery()}>
                  Restore them
                </Button>
              </>
            }
          >
            <p className="font-medium">{LOCAL_RECOVERY_LABEL}.</p>
            <p className="text-xs">
              Found from {new Date(v.recovery.savedAt).toLocaleString()}.
              {v.recovery.baseRevision !== null &&
              v.headRevision !== null &&
              v.recovery.baseRevision !== v.headRevision
                ? ' The server copy has changed since then: restoring puts these older edits on top of it.'
                : ''}
            </p>
          </Banner>
        ) : null}
        {note ? <p className="text-xs text-muted">{note}</p> : null}
      </div>
    </div>
  );
}

const FAILED: Readonly<Record<string, string>> = {
  load: 'Could not open this building.',
  create: 'Not saved.',
  'save-draft': 'Not saved.',
  'discard-draft': 'The draft was not discarded.',
  publish: 'Not published.',
  archive: 'Not archived.',
  restore: 'Not restored.',
  delete: 'Not deleted.',
  duplicate: 'Not duplicated.',
  'apply-template': 'The template was not applied.',
  edit: 'Not possible.',
};
