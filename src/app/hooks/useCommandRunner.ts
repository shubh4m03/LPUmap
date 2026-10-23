import { useCallback } from 'react';
import { useAnnounce, useTheme } from '../../accessibility/index.ts';
import type { CommandId } from '../commands.ts';
import { useAppStore } from '../store/index.ts';

/** Executes palette commands. Every CommandId has a real effect. */
export function useCommandRunner(): (id: CommandId) => void {
  const { resolved, setPreference } = useTheme();
  const announce = useAnnounce();
  return useCallback(
    (id: CommandId) => {
      const s = useAppStore.getState();
      switch (id) {
        case 'toggle-3d': {
          s.toggleMode3d();
          announce(useAppStore.getState().mode3d ? '3D buildings on' : 'Flat 2D map');
          return;
        }
        case 'toggle-theme': {
          const next = resolved === 'dark' ? 'light' : 'dark';
          setPreference(next);
          announce(`${next === 'dark' ? 'Dark' : 'Light'} theme`);
          return;
        }
        case 'reset-view':
          s.requestFocus({ kind: 'reset' });
          return;
        case 'show-layers':
          s.openPanel('layers');
          return;
        case 'locate':
          s.startLocation();
          return;
        case 'favorites':
          s.openPanel('favorites');
          return;
        case 'about':
          s.openPanel('about');
          return;
        case 'settings':
          s.openPanel('settings');
          return;
        case 'campus-info':
          s.openPanel('info');
          return;
        case 'report':
          s.openReport({});
          return;
      }
    },
    [resolved, setPreference, announce],
  );
}
