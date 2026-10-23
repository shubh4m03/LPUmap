import { useId } from 'react';
import {
  CORRECTION_KIND_LABELS,
  CORRECTION_KINDS,
  DETAILS_MAX,
  DETAILS_MIN,
  type CorrectionFormDraft,
} from '../../feedback/index.ts';
import { TextInput, cx } from '../ui/index.ts';
import type { FieldErrors, FieldName } from './report-form.ts';

const FIELD = cx(
  'w-full rounded-md border border-border-strong bg-surface-sunken px-3 text-base text-text',
  'aria-invalid:border-danger focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus',
);

export interface ReportFieldsProps {
  draft: CorrectionFormDraft;
  errors: FieldErrors;
  /** The report is about a specific dataset record: its name is shown, not edited. */
  lockedPlace: boolean;
  onChange: (patch: Partial<CorrectionFormDraft>) => void;
  fieldRef: (name: FieldName) => (el: HTMLElement | null) => void;
}

export function ReportFields({ draft, errors, lockedPlace, onChange, fieldRef }: ReportFieldsProps) {
  const id = useId();
  const length = Array.from(draft.details.trim()).length;
  const ids = {
    kind: `${id}-kind`,
    kindError: `${id}-kind-error`,
    details: `${id}-details`,
    detailsHint: `${id}-details-hint`,
    detailsError: `${id}-details-error`,
  };

  return (
    <div className="flex flex-col gap-4">
      {lockedPlace ? (
        <div className="flex flex-col gap-0.5 text-sm">
          <span className="font-medium">Place</span>
          <span className="text-text">{draft.placeName || draft.placeId}</span>
          <span className="text-xs text-muted">Record id: {draft.placeId}</span>
        </div>
      ) : (
        <TextInput
          ref={fieldRef('placeName')}
          label="Place (optional)"
          hint="The name people use for it, or where it is."
          value={draft.placeName}
          error={errors.placeName}
          maxLength={400}
          onChange={(e) => onChange({ placeName: e.target.value })}
        />
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.kind} className="text-sm font-medium">
          What needs correcting?
        </label>
        <select
          ref={fieldRef('kind')}
          id={ids.kind}
          className={cx(FIELD, 'h-11')}
          value={draft.kind}
          aria-invalid={errors.kind ? true : undefined}
          aria-describedby={errors.kind ? ids.kindError : undefined}
          onChange={(e) => onChange({ kind: e.target.value as CorrectionFormDraft['kind'] })}
        >
          <option value="">Choose one…</option>
          {CORRECTION_KINDS.map((k) => (
            <option key={k} value={k}>
              {CORRECTION_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        {errors.kind ? (
          <p id={ids.kindError} className="text-sm text-danger">
            {errors.kind}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.details} className="text-sm font-medium">
          Details
        </label>
        <textarea
          ref={fieldRef('details')}
          id={ids.details}
          rows={5}
          className={cx(FIELD, 'min-h-28 py-2')}
          value={draft.details}
          aria-invalid={errors.details ? true : undefined}
          aria-describedby={[ids.detailsHint, errors.details ? ids.detailsError : ''].join(' ').trim()}
          onChange={(e) => onChange({ details: e.target.value })}
        />
        <p id={ids.detailsHint} className="flex justify-between gap-3 text-sm text-muted">
          <span>What is wrong and what is correct. Do not include personal information.</span>
          <span className={cx('shrink-0 tabular-nums', length > DETAILS_MAX && 'text-danger')}>
            {length}/{DETAILS_MAX}
            <span className="sr-only"> characters, at least {DETAILS_MIN}</span>
          </span>
        </p>
        {errors.details ? (
          <p id={ids.detailsError} className="text-sm text-danger">
            {errors.details}
          </p>
        ) : null}
      </div>

      <TextInput
        ref={fieldRef('sourceUrl')}
        label="Source link (optional)"
        hint="A public page that confirms the correction, e.g. an official notice."
        type="url"
        inputMode="url"
        autoComplete="off"
        placeholder="https://"
        value={draft.sourceUrl}
        error={errors.sourceUrl}
        onChange={(e) => onChange({ sourceUrl: e.target.value })}
      />
    </div>
  );
}
