import { useCallback } from 'react';
import { currentDraft } from '../../building-studio/editor-state.ts';
import type { StudioDraft } from '../../building-studio/schema.ts';
import { useStudio } from '../../building-studio/ui/store.ts';
import { useStudioServices } from './studio-context.ts';

/**
 * The open draft and one way to change it: every change is an undoable
 * command; `key` coalesces a field's typing into one command until `blur`.
 */
export function useDraftEdit() {
  const { store } = useStudioServices();
  const draft = useStudio(store, (s) => currentDraft(s.editor));
  const editable = useStudio(
    store,
    (s) => s.editor.history !== null && s.editor.head?.status !== 'archived' && !s.editor.dragging,
  );
  const edit = useCallback(
    (fn: (d: StudioDraft) => StudioDraft, label: string, key?: string) => {
      const d = currentDraft(store.getState().editor);
      if (!d) return;
      store.dispatch({ type: 'edit', draft: fn(d), label, coalesceKey: key ?? null });
    },
    [store],
  );
  const blur = useCallback(() => store.dispatch({ type: 'field/blur' }), [store]);
  return { draft, editable, edit, blur };
}
