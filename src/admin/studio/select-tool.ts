import type { StudioTool } from '../../building-studio/editor-state.ts';
import type { StudioStore } from '../../building-studio/ui/store.ts';

/** Selects a tool; Appearance and Info also bring their inspector section into view. */
export function selectTool(store: StudioStore, tool: StudioTool): void {
  store.dispatch({ type: 'tool', tool });
  if (tool !== 'appearance' && tool !== 'info') return;
  store.setState({ inspectorTab: 'properties' });
  // After the inspector has rendered the properties view.
  requestAnimationFrame(() => {
    const el = document.getElementById(`studio-section-${tool}`);
    if (el instanceof HTMLDetailsElement) el.open = true;
    el?.scrollIntoView({ block: 'start' });
  });
}
