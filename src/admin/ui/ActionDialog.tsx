import { useId, type FormEvent, type ReactNode } from 'react';
import { Button } from '../../components/ui/index.ts';
import { Dialog } from '../../components/ui/index.ts';
import type { AdminApiError } from '../api/errors.ts';
import { ErrorNotice } from './ErrorNotice.tsx';

export interface ActionDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  /** Destructive actions use the danger style. */
  danger?: boolean;
  busy: boolean;
  /** Disables the confirm button (e.g. typed confirmation not yet matching). */
  canConfirm?: boolean;
  error: AdminApiError | null;
  errorTitle?: string;
  onReload?: () => void;
  onConfirm(): void;
  onClose(): void;
  children?: ReactNode;
}

/**
 * A confirmation form in a modal dialog: optional fields, the server error
 * (if the last attempt failed) and Cancel / confirm. Closing is blocked while
 * the request runs so the outcome is always shown.
 */
export function ActionDialog({
  open,
  title,
  description,
  confirmLabel,
  danger = false,
  busy,
  canConfirm = true,
  error,
  errorTitle,
  onReload,
  onConfirm,
  onClose,
  children,
}: ActionDialogProps) {
  const formId = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy && canConfirm) onConfirm();
  };
  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={title}
      description={description}
      dismissOnScrim={!busy}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            variant={danger ? 'danger' : 'primary'}
            loading={busy}
            disabled={!canConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {children}
        {error ? <ErrorNotice error={error} title={errorTitle} onReload={onReload} /> : null}
      </form>
    </Dialog>
  );
}
