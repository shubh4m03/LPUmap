import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../../src/app/store/index.ts';
import { MAP_UNAVAILABLE_REASON, VIEW_MODE_NAMES } from '../../../src/app/view-mode.ts';
import { ViewModeSwitcher } from '../../../src/components/map-controls/ViewModeSwitcher.tsx';
import {
  PHOTOREAL_UNAVAILABLE_DETAIL,
  PHOTOREAL_UNAVAILABLE_REASON,
  SATELLITE_NOT_CONFIGURED_REASON,
} from '../../../src/map/providers/types.ts';
import { renderWithAtlas, resetAppStore } from './render-helpers.tsx';

const NOT_CONFIGURED = {
  satellite: SATELLITE_NOT_CONFIGURED_REASON,
  photoreal: PHOTOREAL_UNAVAILABLE_REASON,
};
const CONFIGURED = { satellite: null, photoreal: PHOTOREAL_UNAVAILABLE_REASON };

describe('ViewModeSwitcher', () => {
  beforeEach(() => {
    resetAppStore();
    useAppStore.setState({
      viewMode: 'realistic3d',
      mode3d: true,
      lastMapMode: 'realistic3d',
      availability: NOT_CONFIGURED,
    });
  });
  afterEach(cleanup);

  it('lists the five modes in the owner’s order; one tab stop; arrow keys move and choose', async () => {
    renderWithAtlas(<ViewModeSwitcher />);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual([
      'Satellite map',
      'Photorealistic 3D',
      '3D map',
      'Isometric overview',
      '2D map',
    ]);
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, -1, 0, -1, -1]);
    radios[2]!.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(radios[3]).toHaveFocus();
    expect(useAppStore.getState().viewMode).toBe('isometric');
    await userEvent.keyboard('{End}');
    expect(useAppStore.getState().viewMode).toBe('standard2d');
    // Home lands on Satellite, which is not configured: focus moves, the mode does not.
    await userEvent.keyboard('{Home}');
    expect(radios[0]).toHaveFocus();
    expect(useAppStore.getState().viewMode).toBe('standard2d');
    await userEvent.click(radios[2]!);
    expect(useAppStore.getState().viewMode).toBe('realistic3d');
    expect(await screen.findByText('3D map shown')).toBeInTheDocument();
  });

  it('no accessible name contains another (role queries by name stay unambiguous)', () => {
    const names = Object.values(VIEW_MODE_NAMES);
    for (const a of names)
      for (const b of names) if (a !== b) expect(a.includes(b), `${a} ⊃ ${b}`).toBe(false);
  });

  it('Satellite without a configured source stays visible, says why, and is never chosen', async () => {
    renderWithAtlas(<ViewModeSwitcher />);
    const sat = screen.getByRole('radio', { name: 'Satellite map' });
    expect(sat).toHaveAttribute('aria-disabled', 'true');
    expect(sat).toHaveAccessibleDescription(SATELLITE_NOT_CONFIGURED_REASON);
    await userEvent.click(sat);
    expect(useAppStore.getState().viewMode).toBe('realistic3d');
    // Announced and shown (a toast, so touch users see it too).
    expect(
      (await screen.findAllByText(`Satellite map: ${SATELLITE_NOT_CONFIGURED_REASON}`)).length,
    ).toBeGreaterThan(0);
  });

  it('Photorealistic 3D is always unavailable and explains why in full', async () => {
    act(() => useAppStore.setState({ availability: CONFIGURED }));
    renderWithAtlas(<ViewModeSwitcher />);
    const earth = screen.getByRole('radio', { name: 'Photorealistic 3D' });
    expect(earth).toHaveAttribute('aria-disabled', 'true');
    expect(earth).toHaveAccessibleDescription(PHOTOREAL_UNAVAILABLE_REASON);
    await userEvent.click(earth);
    expect(useAppStore.getState().viewMode).toBe('realistic3d');
    expect(await screen.findByText(PHOTOREAL_UNAVAILABLE_DETAIL)).toBeInTheDocument();
  });

  it('Satellite can be chosen when a free imagery source is configured', async () => {
    act(() => useAppStore.setState({ availability: CONFIGURED }));
    renderWithAtlas(<ViewModeSwitcher />);
    const sat = screen.getByRole('radio', { name: 'Satellite map' });
    expect(sat).not.toHaveAttribute('aria-disabled');
    await userEvent.click(sat);
    expect(useAppStore.getState().viewMode).toBe('satellite2d');
    expect(useAppStore.getState().mode3d).toBe(false);
    expect(sat).toHaveAttribute('aria-checked', 'true');
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
      (await screen.findAllByText('Isometric overview: Not available during live navigation')).length,
    ).toBeGreaterThan(0);
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
