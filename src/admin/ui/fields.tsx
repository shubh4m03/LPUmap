/**
 * Labelled form controls for the admin (multi-line text, select, number,
 * checkbox) styled like components/ui/TextInput. Every control has a visible
 * label, optional hint and error text linked through aria-describedby.
 */
import {
  useId,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cx, FOCUS_RING } from '../../components/ui/cx.ts';

const FIELD = cx(
  'w-full min-w-0 rounded-md border border-border-strong bg-surface-sunken text-base text-text',
  'placeholder:text-subtle disabled:opacity-50 aria-invalid:border-danger',
  FOCUS_RING,
  'focus-visible:outline-offset-0',
);

interface Described {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
}

function useDescribed(id: string | undefined, hint: ReactNode, error: ReactNode) {
  const auto = useId();
  const fieldId = id ?? auto;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  return { fieldId, hintId, errorId, describedBy: [hintId, errorId].filter(Boolean).join(' ') || undefined };
}

function Help({
  hintId,
  hint,
  errorId,
  error,
}: {
  hintId?: string;
  hint: ReactNode;
  errorId?: string;
  error: ReactNode;
}) {
  return (
    <>
      {hint ? (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </>
  );
}

export type TextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> &
  Described & { ref?: Ref<HTMLTextAreaElement> };

export function TextArea({ label, hint, error, className, id, ref, rows = 3, ...rest }: TextAreaProps) {
  const d = useDescribed(id, hint, error);
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={d.fieldId} className="text-sm font-medium text-text">
        {label}
      </label>
      <textarea
        {...rest}
        ref={ref}
        id={d.fieldId}
        rows={rows}
        aria-describedby={d.describedBy}
        aria-invalid={error ? true : undefined}
        className={cx(FIELD, 'px-3 py-2')}
      />
      <Help hintId={d.hintId} hint={hint} errorId={d.errorId} error={error} />
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> &
  Described & { options: readonly SelectOption[]; ref?: Ref<HTMLSelectElement> };

export function SelectField({ label, hint, error, className, id, options, ref, ...rest }: SelectFieldProps) {
  const d = useDescribed(id, hint, error);
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={d.fieldId} className="text-sm font-medium text-text">
        {label}
      </label>
      <select
        {...rest}
        ref={ref}
        id={d.fieldId}
        aria-describedby={d.describedBy}
        aria-invalid={error ? true : undefined}
        className={cx(FIELD, 'h-11 px-3')}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Help hintId={d.hintId} hint={hint} errorId={d.errorId} error={error} />
    </div>
  );
}

export interface CheckboxFieldProps {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function CheckboxField({ label, checked, onChange, hint, disabled, className }: CheckboxFieldProps) {
  const id = useId();
  return (
    <div className={cx('flex items-start gap-3', className)}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={cx('mt-0.5 size-5 shrink-0 accent-accent', FOCUS_RING)}
      />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="text-sm font-medium text-text">
          {label}
        </label>
        {hint ? (
          <p id={`${id}-hint`} className="text-sm text-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
