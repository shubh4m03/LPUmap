/**
 * Correction report dialog. Open while `useAppStore` `reportTarget` is
 * non-null (`openReport(target)` / `closeReport()`); `{}` is a general report.
 *
 * Nothing is sent automatically. The user reviews the exact text, then copies
 * it, downloads it, or (when VITE_CORRECTIONS_URL is configured) opens a
 * prefilled issue on the project's public tracker. The unsent draft is kept
 * in session storage (src/feedback draft store). Reports never include the
 * user's location or device details.
 */
import { useCallback, useRef, useState, type JSX, type RefObject } from 'react';
import { useAnnounce } from '../../accessibility/index.ts';
import { useAtlas } from '../../app/data/atlas-context.ts';
import { useAppStore, type ReportTarget } from '../../app/store/index.ts';
import {
  correctionIssueUrl,
  correctionToText,
  useCorrectionDraft,
  type CorrectionFormDraft,
} from '../../feedback/index.ts';
import { Button, Dialog } from '../ui/index.ts';
import { FIELD_ORDER, errorSummary, freshDraft, initialDraft, validateForm } from './report-form.ts';
import type { FieldErrors, FieldName } from './report-form.ts';
import { ReportFields } from './ReportFields.tsx';
import { ReportReview } from './ReportReview.tsx';

export function ReportDialog(): JSX.Element | null {
  const target = useAppStore((s) => s.reportTarget);
  const close = useAppStore((s) => s.closeReport);
  const focusRef = useRef<HTMLElement | null>(null);
  return (
    <Dialog
      initialFocus={focusRef}
      open={target !== null}
      onClose={close}
      title="Suggest a correction"
      description="Nothing is sent automatically: you choose how to share the report."
      size="md"
    >
      {target ? (
        <ReportFlow
          key={`${target.placeId ?? ''}|${target.placeName ?? ''}|${target.kind ?? ''}`}
          target={target}
          focusRef={focusRef}
        />
      ) : null}
    </Dialog>
  );
}

type Ready = { text: string; issueUrl: string | null };

function ReportFlow({ target, focusRef }: { target: ReportTarget; focusRef: RefObject<HTMLElement | null> }) {
  const { data } = useAtlas();
  const announce = useAnnounce();
  const closeReport = useAppStore((s) => s.closeReport);
  const [init] = useState(() => initialDraft(target, useCorrectionDraft.getState().draft));
  const [draft, setDraft] = useState<CorrectionFormDraft>(init.draft);
  const [restored, setRestored] = useState(init.restored);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [ready, setReady] = useState<Ready | null>(null);
  const fields = useRef<Partial<Record<FieldName, HTMLElement | null>>>({});
  // The dialog opens on the first thing to fill in: the kind if unset, else the details.
  const firstField: FieldName = init.draft.kind === '' ? 'kind' : 'details';
  const fieldRef = useCallback(
    (name: FieldName) => (el: HTMLElement | null) => {
      fields.current[name] = el;
      if (name === firstField && el) focusRef.current = el;
    },
    [firstField, focusRef],
  );
  const datasetVersion = data.manifest.datasetVersion;

  const change = (patch: Partial<CorrectionFormDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    // Persist the whole form once the user edits it (replacing any older draft).
    useCorrectionDraft.getState().update(next);
    const cleared = Object.keys(patch).filter((k) => errors[k as FieldName]);
    if (cleared.length > 0) {
      setErrors((prev) => {
        const copy = { ...prev };
        for (const k of cleared) delete copy[k as FieldName];
        return copy;
      });
    }
  };

  const review = () => {
    const result = validateForm(draft);
    if (!result.ok) {
      setErrors(result.errors);
      announce(errorSummary(result.errors), 'assertive');
      const first = FIELD_ORDER.find((f) => result.errors[f] && fields.current[f]);
      if (first) fields.current[first]?.focus();
      return;
    }
    setErrors({});
    setReady({
      text: correctionToText(result.value, datasetVersion),
      issueUrl: correctionIssueUrl(result.value, datasetVersion),
    });
    announce('Report ready to share. Nothing has been sent.');
  };

  const startOver = () => {
    useCorrectionDraft.getState().reset();
    setDraft(freshDraft(target));
    setRestored(false);
    setErrors({});
  };

  const discard = () => {
    useCorrectionDraft.getState().reset();
    closeReport();
  };

  if (ready) {
    return (
      <ReportReview
        text={ready.text}
        issueUrl={ready.issueUrl}
        datasetVersion={datasetVersion}
        onEdit={() => {
          setReady(null);
          // Return to the field most likely to need changing once the form is back.
          requestAnimationFrame(() => fields.current.details?.focus());
        }}
        onDiscard={discard}
      />
    );
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        review();
      }}
    >
      {restored ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm">
          <span>Restored your unsent draft from this session.</span>
          <Button size="sm" variant="ghost" onClick={startOver}>
            Start over
          </Button>
        </div>
      ) : null}
      <ReportFields
        draft={draft}
        errors={errors}
        lockedPlace={draft.placeId !== ''}
        onChange={change}
        fieldRef={fieldRef}
      />
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button type="submit" variant="primary" icon="chevron-right" iconPosition="end">
          Review report
        </Button>
        <span className="text-sm text-muted">You will see the full text before sharing.</span>
      </div>
    </form>
  );
}
