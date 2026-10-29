/**
 * The Studio toolbar (owner spec B; S13 level-editor layout):
 *  - ToolRail: Add / Select / Move / Rotate / Resize / Appearance / Info, a
 *    vertical rail along the map;
 *  - ActionBar: Undo / Redo · Save draft / Publish / Cancel · Duplicate,
 *    Discard draft, Archive / Restore / Delete, Close.
 * Every action is a real button with a text label; a disabled action says
 * why in its title.
 */
import type { ReactNode } from 'react';
import { Button, cx, type IconName } from '../../components/ui/index.ts';
import { FOCUS_RING } from '../../components/ui/index.ts';
import { Icon } from '../../components/icons/index.ts';
import type { StudioTool } from '../../building-studio/editor.ts';
import { PUBLISH_BLOCKER_TEXT, studioPublishBlockers, studioStatus } from '../../building-studio/ui/index.ts';
import { selectTool } from './select-tool.ts';
import { useStudioServices, useStudioState } from './studio-context.ts';

export type StudioDialog = 'publish' | 'archive' | 'delete' | 'discard-draft' | 'cancel' | 'close' | null;

const TOOLS: readonly { tool: StudioTool; label: string; icon: IconName; hint: string }[] = [
  { tool: 'add', label: 'Add', icon: 'plus', hint: 'Choose a template from the library and place it' },
  { tool: 'select', label: 'Select', icon: 'navigation', hint: 'Pick a building on the map to edit it' },
  { tool: 'move', label: 'Move', icon: 'locate', hint: 'Drag the centre handle, or use the move buttons' },
  { tool: 'rotate', label: 'Rotate', icon: 'reset', hint: 'Drag the rotate handle, or type an angle' },
  { tool: 'resize', label: 'Resize', icon: 'overview', hint: 'Drag a side handle, or type the dimensions' },
  { tool: 'appearance', label: 'Appearance', icon: 'sun', hint: 'Roof, façade, colours and detail level' },
  { tool: 'info', label: 'Info', icon: 'info', hint: 'Name, category, notes and verification' },
];

function useToolbarState() {
  return useStudioState((s) => {
    const st = studioStatus(s);
    const blockers = studioPublishBlockers(s);
    return {
      tool: s.editor.tool,
      open: s.editor.history !== null,
      placing: s.editor.placement !== null,
      onServer: s.editor.head !== null,
      status: s.editor.head?.status ?? null,
      hasDraft: s.editor.head?.hasDraft ?? false,
      published: (s.editor.head?.publishedVersion ?? null) !== null,
      pending: s.editor.pending !== null,
      dirty: st.dirty,
      canUndo: st.canUndo,
      canRedo: st.canRedo,
      undoLabel: st.undoLabel,
      redoLabel: st.redoLabel,
      blocker: blockers[0] ?? null,
      prism: s.editor.history?.present.model.generatorId === 'footprint-prism',
    };
  });
}

export function ToolRail({
  onOpenLibrary,
  onOpenInspector,
}: {
  onOpenLibrary(): void;
  /** Appearance and Info edit in the inspector: it is shown if it was collapsed. */
  onOpenInspector?(): void;
}) {
  const { store } = useStudioServices();
  const v = useToolbarState();
  const archived = v.status === 'archived';
  const editable = v.open && !archived;
  return (
    <div
      role="toolbar"
      aria-label="Studio tools"
      aria-orientation="vertical"
      className="flex flex-col gap-1 rounded-xl border border-border bg-surface-raised p-1 shadow-2"
    >
      {TOOLS.map((t) => {
        const needsModel = t.tool !== 'add' && t.tool !== 'select';
        const noHandles = v.prism && (t.tool === 'move' || t.tool === 'rotate' || t.tool === 'resize');
        const disabled =
          (needsModel && !editable) || (t.tool === 'add' && (v.dirty || v.pending)) || noHandles;
        const why = noHandles
          ? 'The mapped footprint of an existing building is not moved by handles.'
          : t.tool === 'add' && v.dirty
            ? 'Save or cancel the open changes before placing another building.'
            : needsModel && !editable
              ? archived
                ? 'Restore this building to edit it.'
                : 'Open or place a building first.'
              : t.hint;
        return (
          <button
            key={t.tool}
            type="button"
            aria-pressed={v.tool === t.tool}
            disabled={disabled}
            title={why}
            data-testid={`studio-tool-${t.tool}`}
            onClick={() => {
              if (t.tool === 'add') onOpenLibrary();
              if (t.tool === 'appearance' || t.tool === 'info') onOpenInspector?.();
              selectTool(store, t.tool);
            }}
            className={cx(
              'flex w-[4.5rem] flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[0.7rem] leading-tight font-medium',
              'disabled:cursor-not-allowed disabled:opacity-40 pointer-coarse:min-h-11',
              v.tool === t.tool ? 'bg-accent-soft text-accent-text' : 'text-text hover:bg-surface-hover',
              FOCUS_RING,
            )}
          >
            <Icon name={t.icon} size={20} />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function ActionButton(props: {
  label: string;
  icon: IconName;
  disabled?: boolean;
  title?: string;
  onClick(): void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      title={props.title}
      data-testid={props.testId}
      onClick={props.onClick}
      className={cx(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium whitespace-nowrap',
        'pointer-coarse:min-h-11 disabled:cursor-not-allowed disabled:opacity-45',
        'text-text hover:bg-surface-hover',
        FOCUS_RING,
      )}
    >
      <Icon name={props.icon} size={18} />
      {props.label}
    </button>
  );
}

const Divider = () => <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-border" />;

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1">
      {children}
    </div>
  );
}

export interface ActionBarProps {
  onDialog(d: StudioDialog): void;
}

export function ActionBar({ onDialog }: ActionBarProps) {
  const { store, actions } = useStudioServices();
  const v = useToolbarState();
  const archived = v.status === 'archived';
  const editable = v.open && !archived;
  return (
    <div role="toolbar" aria-label="Studio actions" className="flex min-w-0 flex-wrap items-center gap-y-1">
      <Group label="History">
        <ActionButton
          label="Undo"
          icon="chevron-left"
          disabled={!v.canUndo}
          title={v.undoLabel ? `Undo: ${v.undoLabel}` : 'Nothing to undo'}
          onClick={() => store.dispatch({ type: 'undo' })}
          testId="studio-undo"
        />
        <ActionButton
          label="Redo"
          icon="chevron-right"
          disabled={!v.canRedo}
          title={v.redoLabel ? `Redo: ${v.redoLabel}` : 'Nothing to redo'}
          onClick={() => store.dispatch({ type: 'redo' })}
          testId="studio-redo"
        />
      </Group>
      <Divider />
      <Group label="Save and publish">
        <Button
          size="sm"
          variant="secondary"
          icon="check"
          disabled={!editable || !v.dirty || v.pending}
          title={!v.dirty ? 'No unsaved changes' : 'Save these changes as a draft on the server'}
          onClick={() => void actions.saveDraft()}
          data-testid="studio-save"
        >
          Save draft
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon="globe"
          disabled={v.blocker !== null}
          title={v.blocker ? PUBLISH_BLOCKER_TEXT[v.blocker] : 'Review and publish this draft'}
          onClick={() => onDialog('publish')}
          data-testid="studio-publish"
        >
          Publish…
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!v.dirty || v.pending}
          title={v.dirty ? 'Discard unsaved local changes' : 'No unsaved changes'}
          onClick={() => onDialog('cancel')}
          data-testid="studio-cancel"
        >
          Cancel
        </Button>
      </Group>
      <Divider />
      <Group label="Record">
        <ActionButton
          label="Duplicate"
          icon="layers"
          disabled={!v.onServer || v.dirty || v.pending || archived}
          title={
            !v.onServer
              ? 'Save the draft first.'
              : v.dirty
                ? 'Save or cancel the open changes first.'
                : 'Copy as a new unpublished draft beside this one'
          }
          onClick={() => void actions.duplicate()}
          testId="studio-duplicate"
        />
        {v.hasDraft && v.published && !archived ? (
          <ActionButton
            label="Discard draft"
            icon="close"
            disabled={v.pending || v.dirty}
            title={
              v.dirty
                ? 'Save or cancel the open changes first.'
                : 'Drop the server draft; the published version stays'
            }
            onClick={() => onDialog('discard-draft')}
          />
        ) : null}
        {archived ? (
          <>
            <ActionButton
              label="Restore"
              icon="history"
              disabled={v.pending}
              title="Bring this building back (re-validated)"
              onClick={() => void actions.restore()}
              testId="studio-restore"
            />
            <ActionButton
              label="Delete…"
              icon="trash"
              disabled={v.pending}
              title="Permanently delete (typed confirmation)"
              onClick={() => onDialog('delete')}
              testId="studio-delete"
            />
          </>
        ) : (
          <ActionButton
            label="Archive…"
            icon="trash"
            disabled={!v.onServer || v.pending || v.dirty}
            title={
              !v.onServer
                ? 'Only a saved building can be archived.'
                : v.dirty
                  ? 'Save or cancel the open changes first.'
                  : 'Remove from the public map (recoverable)'
            }
            onClick={() => onDialog('archive')}
            testId="studio-archive"
          />
        )}
        <ActionButton
          label="Close"
          icon="close"
          disabled={(!v.open && !v.placing) || v.pending}
          title="Close this building and return to normal map navigation"
          onClick={() => (v.dirty ? onDialog('close') : actions.exit())}
          testId="studio-close"
        />
      </Group>
    </div>
  );
}
