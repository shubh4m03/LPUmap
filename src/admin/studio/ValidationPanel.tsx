/**
 * Live server checks of the open (or previewed) draft (S6), grouped by
 * severity with the reason and how to resolve each. Warnings take an
 * acknowledgement with a reason (5–300 characters) per code; errors —
 * including off-campus — can never be acknowledged. The result shown is
 * always the one for exactly this draft; while a newer check runs, it says so.
 */
import { useMemo } from 'react';
import { Badge, Button, Spinner } from '../../components/ui/index.ts';
import { cx } from '../../components/ui/cx.ts';
import { prohibitedSourceProblem } from '../../building-studio/ui/fields.ts';
import {
  ACK_REASON_MAX,
  ACK_REASON_MIN,
  currentValidation,
  validAckReason,
} from '../../building-studio/ui/store.ts';
import { groupIssues, RESOLVE_HINTS, SEVERITY_HEADINGS } from '../../building-studio/ui/text.ts';
import type { ValidationIssue, WarningCode } from '../../building-studio/schema.ts';
import { TextField } from './controls.tsx';
import { useStudioServices, useStudioState } from './studio-context.ts';

const TONE = { error: 'danger', warning: 'warning', info: 'info' } as const;

export function AckField({ code, compact = false }: { code: WarningCode; compact?: boolean }) {
  const { store } = useStudioServices();
  const reason = useStudioState((s) => s.acknowledgements[code] ?? '');
  const problem =
    prohibitedSourceProblem(reason, 'text') ??
    (reason.trim() !== '' && !validAckReason(reason)
      ? `Give a reason of ${ACK_REASON_MIN}–${ACK_REASON_MAX} characters.`
      : null);
  return (
    <TextField
      label={compact ? `Reason for acknowledging ${code}` : 'Acknowledge: why is this acceptable?'}
      value={reason}
      maxLength={ACK_REASON_MAX}
      error={problem}
      testId={`studio-ack-${code}`}
      hint={validAckReason(reason) && !problem ? 'Acknowledged (recorded with the publication).' : undefined}
      onChange={(v) => store.setState((s) => ({ acknowledgements: { ...s.acknowledgements, [code]: v } }))}
    />
  );
}

function IssueItem({ issue, ackShown }: { issue: ValidationIssue; ackShown: boolean }) {
  return (
    <li
      className="flex flex-col gap-1.5 rounded-md border border-border p-2.5"
      data-testid={`studio-issue-${issue.code}`}
    >
      <div className="flex items-start gap-2">
        <Badge tone={TONE[issue.severity]}>{issue.severity}</Badge>
        <p className="min-w-0 flex-1 text-sm">{issue.message}</p>
      </div>
      <p className="text-xs text-muted">{RESOLVE_HINTS[issue.code]}</p>
      {issue.severity === 'warning' && ackShown ? <AckField code={issue.code as WarningCode} /> : null}
      {issue.severity === 'error' ? (
        <p className="text-xs text-muted">Errors cannot be acknowledged.</p>
      ) : null}
    </li>
  );
}

export function ValidationPanel() {
  const { actions } = useStudioServices();
  const v = useStudioState((s) => ({
    result: currentValidation(s),
    stale: s.validation !== null && currentValidation(s) === null,
    validating: s.validating,
    error: s.validationError,
    hasTarget: s.editor.history !== null || s.editor.placement !== null,
  }));
  const groups = useMemo(() => (v.result ? groupIssues(v.result.issues) : null), [v.result]);
  if (!v.hasTarget) return null;
  return (
    <section
      aria-labelledby="studio-checks-title"
      className="flex flex-col gap-3 p-4"
      data-testid="studio-checks"
    >
      <div className="flex items-center gap-2">
        <h2 id="studio-checks-title" className="flex-1 text-sm font-semibold">
          Checks
        </h2>
        {v.validating ? <Spinner label="Checking with the server…" size={16} /> : null}
        <Button
          size="sm"
          variant="ghost"
          icon="reset"
          onClick={() => void actions.validate()}
          disabled={v.validating}
        >
          Check now
        </Button>
      </div>
      {v.error ? (
        <p role="alert" className="rounded-md bg-danger-soft p-2 text-sm text-danger">
          {v.error}
        </p>
      ) : null}
      {!v.result ? (
        <p className="text-sm text-muted" role="status">
          {v.validating || v.stale ? 'Checking this exact draft with the server…' : 'Not checked yet.'}
        </p>
      ) : (
        <>
          <p role="status" className={cx('text-sm', v.result.errorCount > 0 ? 'text-danger' : 'text-text')}>
            {v.result.errorCount} {v.result.errorCount === 1 ? 'error' : 'errors'}, {v.result.warningCount}{' '}
            {v.result.warningCount === 1 ? 'warning' : 'warnings'}.{' '}
            {v.result.errorCount > 0
              ? 'Publishing is blocked until the errors are fixed (a draft can still be saved).'
              : v.result.warningCount > 0
                ? 'Each warning needs an acknowledgement with a reason before publishing.'
                : 'No problems found.'}
          </p>
          {(['error', 'warning'] as const).map((sev) =>
            groups && groups[sev].length > 0 ? (
              <div key={sev} className="flex flex-col gap-1.5">
                <h3 className="text-xs font-semibold text-muted">{SEVERITY_HEADINGS[sev]}</h3>
                <ul className="flex flex-col gap-1.5">
                  {groups[sev].map((issue, i) => (
                    <IssueItem
                      key={`${issue.code}-${issue.path ?? ''}-${i}`}
                      issue={issue}
                      // One acknowledgement per code: shown with the first issue of that code.
                      ackShown={groups[sev].findIndex((x) => x.code === issue.code) === i}
                    />
                  ))}
                </ul>
              </div>
            ) : null,
          )}
          {groups && groups.info.length > 0 ? (
            <details className="group" open={groups.info.length <= 3}>
              <summary className="cursor-pointer text-xs font-semibold text-muted">
                {SEVERITY_HEADINGS.info} · {groups.info.length}
              </summary>
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {groups.info.map((issue, i) => (
                  <IssueItem key={`${issue.code}-${issue.path ?? ''}-${i}`} issue={issue} ackShown={false} />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}
