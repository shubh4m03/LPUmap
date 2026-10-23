import { useId, useRef, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';
import { Icon } from '../icons/Icon.tsx';
import type { IconName } from '../icons/icon-paths.ts';
import { cx, FOCUS_RING } from './cx.ts';

type LabelProps =
  | { label: string; hideLabel?: boolean; 'aria-label'?: never }
  | { label?: never; hideLabel?: never; 'aria-label': string };

export type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'aria-label' | 'size'> &
  LabelProps & {
    /** Help text linked through aria-describedby. */
    hint?: ReactNode;
    /** Error text; sets aria-invalid and is linked through aria-describedby. */
    error?: ReactNode;
    icon?: IconName;
    /** Shows a clear button when the value is non-empty. */
    onClear?: () => void;
    clearLabel?: string;
    ref?: Ref<HTMLInputElement>;
  };

const FIELD = cx(
  'h-11 w-full min-w-0 rounded-md border border-border-strong bg-surface-sunken text-base text-text',
  'placeholder:text-subtle disabled:opacity-50 aria-invalid:border-danger',
  FOCUS_RING,
  'focus-visible:outline-offset-0',
);

/** Labelled text field. Requires either a visible `label` or an `aria-label`. */
export function TextInput(props: TextInputProps) {
  const {
    label,
    hideLabel,
    hint,
    error,
    icon,
    onClear,
    clearLabel = 'Clear',
    className,
    id,
    ref,
    ...inputProps
  } = props;
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy =
    [inputProps['aria-describedby'], hintId, errorId].filter(Boolean).join(' ') || undefined;
  const innerRef = useRef<HTMLInputElement | null>(null);
  const hasValue = inputProps.value !== undefined && String(inputProps.value).length > 0;

  const setRefs = (el: HTMLInputElement | null) => {
    innerRef.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  };

  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      {label ? (
        <label htmlFor={inputId} className={hideLabel ? 'sr-only' : 'text-sm font-medium text-text'}>
          {label}
        </label>
      ) : null}
      <div className="relative flex items-center">
        {icon ? (
          <Icon name={icon} size={20} className="pointer-events-none absolute left-3 text-subtle" />
        ) : null}
        <input
          {...inputProps}
          ref={setRefs}
          id={inputId}
          aria-describedby={describedBy}
          aria-invalid={error ? true : inputProps['aria-invalid']}
          className={cx(FIELD, icon ? 'pl-10' : 'pl-3', onClear && hasValue ? 'pr-11' : 'pr-3')}
        />
        {onClear && hasValue ? (
          <button
            type="button"
            aria-label={clearLabel}
            title={clearLabel}
            onClick={() => {
              onClear();
              innerRef.current?.focus();
            }}
            className={cx(
              'absolute right-1 inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-surface-hover hover:text-text',
              FOCUS_RING,
            )}
          >
            <Icon name="close" size={18} />
          </button>
        ) : null}
      </div>
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
    </div>
  );
}

export type SearchInputProps = Omit<TextInputProps, 'type' | 'icon'>;

/** Search field: type=search, search icon, clear button, Escape clears when non-empty. */
export function SearchInput({ onKeyDown, onClear, clearLabel = 'Clear search', ...props }: SearchInputProps) {
  return (
    <TextInput
      {...(props as TextInputProps)}
      type="search"
      icon="search"
      enterKeyHint="search"
      autoComplete="off"
      spellCheck={false}
      clearLabel={clearLabel}
      onClear={onClear}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (!e.defaultPrevented && e.key === 'Escape' && onClear && String(props.value ?? '').length > 0) {
          e.preventDefault();
          onClear();
        }
      }}
    />
  );
}
