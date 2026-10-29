import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../../src/app/store/index.ts';
import { MapControls } from '../../../src/components/map-controls/MapControls.tsx';
import { renderWithAtlas, resetAppStore } from './render-helpers.tsx';

// G-13: phones had no reset-view control (it was rendered only when !compact).
describe('MapControls reset view', () => {
  beforeEach(resetAppStore);
  afterEach(cleanup);

  for (const compact of [false, true]) {
    it(`${compact ? 'phone' : 'desktop'} stack offers "Reset view" and requests a reset focus`, async () => {
      renderWithAtlas(<MapControls compact={compact} />);
      await userEvent.click(screen.getByRole('button', { name: 'Reset view to the whole campus' }));
      expect(useAppStore.getState().focusRequest?.kind).toBe('reset');
    });
  }

  it('phone: steps aside while the bottom sheet is open; the desktop stack keeps it', () => {
    // The open sheet lifts the map attribution to just under the column; one more button there
    // put "Show my location" over it (axe target-size on phones).
    useAppStore.getState().openPanel('details');
    const { unmount } = renderWithAtlas(<MapControls compact />);
    expect(screen.queryByRole('button', { name: 'Reset view to the whole campus' })).toBeNull();
    act(() => useAppStore.getState().closePanel());
    expect(screen.getByRole('button', { name: 'Reset view to the whole campus' })).toBeTruthy();
    unmount();
    act(() => useAppStore.getState().openPanel('details'));
    renderWithAtlas(<MapControls />);
    expect(screen.getByRole('button', { name: 'Reset view to the whole campus' })).toBeTruthy();
  });
});
