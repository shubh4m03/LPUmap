import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../../src/app/store/index.ts';
import { MAP_UNAVAILABLE_REASON } from '../../../src/app/view-mode.ts';
import { ViewModeSwitcher } from '../../../src/components/map-controls/ViewModeSwitcher.tsx';
import { renderWithAtlas, resetAppStore } from './render-helpers.tsx';

describe('ViewModeSwitcher', () => {
  beforeEach(() => {
    resetAppStore();
    useAppStore.setState({ viewMode: 'realistic3d', mode3d: true, lastMapMode: 'realistic3d' });
  });
  afterEach(cleanup);

  it('is one radio group with one tab stop; arrow keys move and choose', async () => {
    renderWithAtlas(<ViewModeSwitcher />);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual([
      '3D map',
      'Isometric overview',
      '2D map',
    ]);
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    radios[0]!.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(radios[1]).toHaveFocus();
    expect(useAppStore.getState().viewMode).toBe('isometric');
    await userEvent.keyboard('{End}');
    expect(useAppStore.getState().viewMode).toBe('standard2d');
    await userEvent.keyboard('{Home}');
    expect(useAppStore.getState().viewMode).toBe('realistic3d');
    expect(await screen.findByText('3D map shown')).toBeInTheDocument();
  });

  it('a blocked option stays focusable, says why, and is never chosen', async () => {
    renderWithAtlas(<ViewModeSwitcher compact />);
    act(() => useAppStore.setState({ navigationActive: true }));
    const overview = screen.getByRole('radio', { name: 'Isometric overview' });
    expect(overview).toHaveAttribute('aria-disabled', 'true');
    expect(overview).toHaveAccessibleDescription('Not available during live navigation');
    screen.getByRole('radio', { name: '3D map' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(overview).toHaveFocus();
    expect(useAppStore.getState().viewMode).toBe('realistic3d');
    expect(
      await screen.findByText('Isometric overview: Not available during live navigation'),
    ).toBeInTheDocument();
    act(() => useAppStore.setState({ navigationActive: false }));
  });

  it('without WebGL only the overview can be chosen', async () => {
    renderWithAtlas(<ViewModeSwitcher />);
    act(() => useAppStore.getState().setMapUnavailable(MAP_UNAVAILABLE_REASON));
    const map2d = screen.getByRole('radio', { name: '2D map' });
    expect(map2d).toHaveAccessibleDescription(MAP_UNAVAILABLE_REASON);
    await userEvent.click(map2d);
    expect(useAppStore.getState().viewMode).toBe('isometric');
    expect(screen.getByRole('radio', { name: 'Isometric overview' })).toHaveAttribute('aria-checked', 'true');
  });
});
