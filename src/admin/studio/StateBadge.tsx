import { Badge, type BadgeTone } from '../../components/ui/index.ts';
import type { StatusKind } from '../../building-studio/editor-state.ts';
import { studioStatus } from '../../building-studio/ui/store.ts';
import { useStudioState } from './studio-context.ts';

const TONE: Readonly<Record<StatusKind, BadgeTone>> = {
  none: 'neutral',
  unsaved: 'warning',
  'saved-draft': 'info',
  published: 'success',
  archived: 'danger',
};

/**
 * The record state, always visible (S10): unsaved local changes · saved
 * draft (rev n) · published (version n) · archived — plus what the server
 * holds underneath unsaved changes.
 */
export function StateBadge({ compact = false }: { compact?: boolean }) {
  const { kind, label, serverLabel, placement, pending } = useStudioState((s) => {
    const st = studioStatus(s);
    return {
      kind: st.kind,
      label: st.label,
      serverLabel: st.serverLabel,
      placement: s.editor.placement !== null && s.editor.history === null,
      pending: s.editor.pending?.op ?? null,
    };
  });
  const text = placement ? 'Placing (preview only, nothing saved)' : label;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="studio-state"
      className="flex min-w-0 flex-wrap items-center gap-1.5"
    >
      <span data-testid="studio-state-label" className="inline-flex min-w-0">
        <Badge
          tone={placement ? 'accent' : TONE[kind]}
          icon={kind === 'unsaved' ? 'warning' : undefined}
          // Compact (phones): the label wraps instead of being cut off, so it is always readable.
          className={compact ? 'rounded-lg leading-4 [&>span]:whitespace-normal' : undefined}
        >
          {text}
        </Badge>
      </span>
      {serverLabel && !compact ? (
        <span className="truncate text-xs text-muted" data-testid="studio-server-state">
          Server: {serverLabel}
        </span>
      ) : null}
      {pending && pending !== 'validate' ? (
        <span className="text-xs text-muted">{PENDING_TEXT[pending] ?? 'Working…'}</span>
      ) : null}
    </div>
  );
}

const PENDING_TEXT: Readonly<Record<string, string>> = {
  load: 'Loading…',
  create: 'Saving…',
  'save-draft': 'Saving…',
  'discard-draft': 'Discarding draft…',
  publish: 'Publishing…',
  archive: 'Archiving…',
  restore: 'Restoring…',
  delete: 'Deleting…',
  duplicate: 'Duplicating…',
  'apply-template': 'Applying template…',
};
