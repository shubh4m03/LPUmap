/**
 * Small form controls of the Studio inspector. Numeric fields keep their own
 * text while focused (so "12." or an empty field can be typed) and report a
 * value only when it parses; the store coalesces a field's edits into one
 * undo command until the field loses focus (S9).
 */
import { useEffect, useId, useRef, useState, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cx, FOCUS_RING } from '../../components/ui/index.ts';
import { Icon } from '../../components/icons/index.ts';

const INPUT = cx(
  'h-10 w-full min-w-0 rounded-md border border-border-strong bg-surface-sunken px-2.5 text-sm text-text',
  'pointer-coarse:h-11 disabled:opacity-50 aria-invalid:border-danger',
  FOCUS_RING,
  'focus-visible:outline-offset-0',
);

export interface NumberFieldProps {
  label: string;
  value: number;
  /** Returns an error message (nothing changes) or null (the value is applied). */
  onValue(v: number): string | null;
  onBlur?(): void;
  unit?: string;
  step?: number;
  /** Non-blocking note (e.g. outside the publish range). */
  warning?: string | null;
  hint?: ReactNode;
  disabled?: boolean;
  integer?: boolean;
  className?: string;
  testId?: string;
}

/**
 * Decimal places a field shows and steps on: at least 3, and enough for one
 * `step` (0.00001° → 5, about 1 m), so a coordinate is never shown or nudged
 * on a 0.001° (~100 m) grid.
 */
function fieldDecimals(step: number): number {
  const s = String(step);
  const exp = /e-(\d+)$/.exec(s);
  return Math.max(3, exp ? Number(exp[1]) : (s.split('.')[1]?.length ?? 0));
}

const roundTo = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
const fmt = (v: number, digits: number) => String(roundTo(v, digits));

export function NumberField(props: NumberFieldProps) {
  const {
    label,
    value,
    onValue,
    onBlur,
    unit,
    step = 0.1,
    warning,
    hint,
    disabled,
    integer,
    className,
  } = props;
  const id = useId();
  const digits = fieldDecimals(step);
  const [text, setText] = useState(fmt(value, digits));
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(fmt(value, digits));
  }, [value, digits]);
  const describedBy = [error ? `${id}-err` : null, warning ? `${id}-warn` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cx('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
        {unit ? <span className="font-normal"> ({unit})</span> : null}
      </label>
      <input
        id={id}
        type="text"
        inputMode={integer ? 'numeric' : 'decimal'}
        className={INPUT}
        value={text}
        disabled={disabled}
        data-testid={props.testId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          const v = Number(t.replace(',', '.'));
          if (t.trim() === '' || !Number.isFinite(v)) {
            setError('Enter a number.');
            return;
          }
          if (integer && !Number.isInteger(v)) {
            setError('Enter a whole number.');
            return;
          }
          setError(onValue(v));
        }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          const v = Number(text.replace(',', '.'));
          // Unedited text is the rounded display of `value`: step from the exact value.
          const base = text === fmt(value, digits) || !Number.isFinite(v) ? value : v;
          const next = roundTo(base + (e.key === 'ArrowUp' ? step : -step), digits);
          setText(fmt(next, digits));
          setError(onValue(next));
        }}
        onBlur={() => {
          focused.current = false;
          setError(null);
          setText(fmt(value, digits));
          onBlur?.();
        }}
      />
      {error ? (
        <p id={`${id}-err`} className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      {warning ? (
        <p id={`${id}-warn`} className="flex items-start gap-1 text-xs text-warning">
          <Icon name="warning" size={14} className="mt-px shrink-0" />
          {warning}
        </p>
      ) : null}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface TextFieldProps {
  label: string;
  value: string;
  onChange(v: string): void;
  onBlur?(): void;
  multiline?: boolean;
  placeholder?: string;
  error?: string | null;
  hint?: ReactNode;
  maxLength?: number;
  type?: 'text' | 'url' | 'date';
  testId?: string;
  disabled?: boolean;
}

export function TextField(props: TextFieldProps) {
  const id = useId();
  const {
    label,
    value,
    onChange,
    onBlur,
    multiline,
    placeholder,
    error,
    hint,
    maxLength,
    type = 'text',
  } = props;
  const describedBy = [error ? `${id}-err` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ');
  const common = {
    id,
    value,
    placeholder,
    maxLength,
    disabled: props.disabled,
    'data-testid': props.testId,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy || undefined,
    onBlur,
  };
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      {multiline ? (
        <textarea
          {...common}
          rows={3}
          className={cx(INPUT, 'h-auto min-h-20 py-2')}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input {...common} type={type} className={INPUT} onChange={(e) => onChange(e.target.value)} />
      )}
      {error ? (
        <p id={`${id}-err`} className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  label: string;
  options: readonly { value: string; label: string }[];
  onValue(v: string): void;
  hint?: ReactNode;
}

export function SelectField({ label, options, onValue, hint, className, ...rest }: SelectFieldProps) {
  const id = useId();
  return (
    <div className={cx('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      <select
        {...rest}
        id={id}
        className={cx(INPUT, 'pr-8')}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => onValue(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function CheckField(props: {
  label: string;
  checked: boolean;
  onChange(v: boolean): void;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-2">
      <input
        id={id}
        type="checkbox"
        className={cx('mt-0.5 size-4 shrink-0 accent-accent pointer-coarse:size-5', FOCUS_RING)}
        checked={props.checked}
        disabled={props.disabled}
        aria-describedby={props.hint ? `${id}-hint` : undefined}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm text-text">
          {props.label}
        </label>
        {props.hint ? (
          <p id={`${id}-hint`} className="text-xs text-muted">
            {props.hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Collapsible inspector section (a native <details>, keyboard accessible). */
export function PanelSection(props: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  id?: string;
  badge?: ReactNode;
  /** Called with the new open state when the user opens or closes the section. */
  onToggle?: (open: boolean) => void;
}) {
  const { onToggle } = props;
  return (
    <details
      id={props.id}
      open={props.defaultOpen ?? true}
      onToggle={onToggle ? (e) => onToggle(e.currentTarget.open) : undefined}
      className="group scroll-mt-2 border-b border-border last:border-b-0"
    >
      <summary
        className={cx(
          'flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2 text-sm font-semibold select-none',
          '[&::-webkit-details-marker]:hidden',
          FOCUS_RING,
        )}
      >
        <Icon
          name="chevron-right"
          size={16}
          className="shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
        />
        <span className="min-w-0 flex-1">{props.title}</span>
        {props.badge}
      </summary>
      <div className="flex flex-col gap-3 px-4 pb-4">{props.children}</div>
    </details>
  );
}
