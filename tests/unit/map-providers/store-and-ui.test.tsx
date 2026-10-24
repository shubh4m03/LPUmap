/**
 * Store fallback on imagery failure / offline, the reporter hook's notice, the
 * imagery notice and the return-to-campus control.
 */
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveRegion } from '../../../src/accessibility/index.ts';
import {
  useImageryFailureReporter,
  useImageryRuntimeSync,
} from '../../../src/app/hooks/useImageryRuntime.ts';
import { createAppStore, useAppStore } from '../../../src/app/store/index.ts';
import { ImageryNotice } from '../../../src/components/map-controls/ImageryNotice.tsx';
import {
  RETURN_TO_CAMPUS_LABEL,
  ReturnToCampusButton,
} from '../../../src/components/map-controls/ReturnToCampusButton.tsx';
import { ToastProvider } from '../../../src/components/ui/index.ts';
import { parseProviderEnv } from '../../../src/map/providers/config.ts';
import { eoxSentinel2016 } from '../../../src/map/providers/eox.ts';
import { ESRI_IMAGERY_DATE, esriWorldImagery } from '../../../src/map/providers/esri.ts';
import { createProviderRegistry } from '../../../src/map/providers/registry.ts';
import {
  PROVIDER_FAILURE_REASONS,
  SATELLITE_NOT_CONFIGURED_REASON,
} from '../../../src/map/providers/types.ts';
import { resetAppStore } from '../app/render-helpers.tsx';

const FAKE_KEY = 'TEST_ONLY_fake_arcgis_key_0123456789abcdef';
const ESRI_REG = createProviderRegistry(parseProviderEnv({ VITE_ARCGIS_API_KEY: FAKE_KEY }));

afterEach(() => {
  cleanup();
  resetAppStore();
});

describe('store: imagery availability and fallback', () => {
  it('without providers Satellite cannot be entered and says why', () => {
    const store = createAppStore({
      map: { viewMode: 'standard2d', providers: createProviderRegistry(parseProviderEnv({})) },
    });
    expect(store.getState().availability.satellite).toBe(SATELLITE_NOT_CONFIGURED_REASON);
    expect(store.getState().setViewMode('satellite2d')).toBe(false);
    expect(store.getState().viewMode).toBe('standard2d');
  });

  it('with a provider Satellite works; a failure moves to the campus map and returns the reason', () => {
    const store = createAppStore({ map: { viewMode: 'standard2d', providers: ESRI_REG } });
    expect(store.getState().setViewMode('satellite2d')).toBe(true);
    expect(store.getState().mode3d).toBe(false);
    const resolved = store.getState().setImageryRuntime({ failure: 'quota', online: true });
    expect(resolved).toEqual({
      mode: 'standard2d',
      fallbackFrom: 'satellite2d',
      reason: PROVIDER_FAILURE_REASONS.quota,
    });
    const s = store.getState();
    expect(s.viewMode).toBe('standard2d');
    expect(s.viewModeReason).toBe('fallback');
    expect(s.availability.satellite).toBe(PROVIDER_FAILURE_REASONS.quota);
    expect(s.setViewMode('satellite2d')).toBe(false);
  });

  it('Campus 3D stays in place when imagery fails (it simply loses the imagery)', () => {
    const store = createAppStore({ map: { viewMode: 'realistic3d', providers: ESRI_REG } });
    expect(store.getState().setImageryRuntime({ failure: 'auth', online: true })).toBeNull();
    expect(store.getState().viewMode).toBe('realistic3d');
  });

  it('back online clears a network failure (the mode is not switched back automatically)', () => {
    const store = createAppStore({ map: { viewMode: 'satellite2d', providers: ESRI_REG } });
    store.getState().setImageryRuntime({ failure: null, online: false });
    expect(store.getState().viewMode).toBe('standard2d');
    store.getState().setImageryRuntime({ failure: null, online: true });
    expect(store.getState().availability.satellite).toBeNull();
    expect(store.getState().viewMode).toBe('standard2d');
  });
});

/** The singleton store in Satellite 2D with an Esri provider (its actions read `providers` from state). */
function useSatelliteWithEsri(): void {
  const fresh = createAppStore({ map: { viewMode: 'satellite2d', providers: ESRI_REG } }).getState();
  useAppStore.setState({
    providers: ESRI_REG,
    availability: fresh.availability,
    imageryRuntime: fresh.imageryRuntime,
    viewMode: 'satellite2d',
    mode3d: false,
    navigationActive: false,
    mapUnavailable: null,
  });
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      {children}
      <LiveRegion />
    </ToastProvider>
  );
}

describe('hooks', () => {
  it('the failure reporter falls back once and shows the reason', async () => {
    useSatelliteWithEsri();
    const { result } = renderHook(() => useImageryFailureReporter(), { wrapper });
    act(() => result.current('auth'));
    act(() => result.current('quota'));
    expect(useAppStore.getState().viewMode).toBe('standard2d');
    expect(useAppStore.getState().imageryRuntime.failure).toBe('auth');
    expect((await screen.findAllByText(PROVIDER_FAILURE_REASONS.auth)).length).toBeGreaterThan(0);
    expect(screen.queryByText(PROVIDER_FAILURE_REASONS.quota)).toBeNull();
  });

  it('in Campus 3D the notice says the 3D view continues without imagery', async () => {
    useSatelliteWithEsri();
    act(() => useAppStore.getState().setViewMode('realistic3d'));
    const { result } = renderHook(() => useImageryFailureReporter(), { wrapper });
    act(() => result.current('network'));
    expect(useAppStore.getState().viewMode).toBe('realistic3d');
    expect(
      (
        await screen.findAllByText(
          'Satellite imagery could not be loaded (offline or unreachable). Campus 3D continues without imagery.',
        )
      ).length,
    ).toBeGreaterThan(0);
  });

  it('going offline in Satellite 2D falls back with a notice; online again clears the failure', async () => {
    useSatelliteWithEsri();
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    renderHook(() => useImageryRuntimeSync(), { wrapper });
    expect(useAppStore.getState().viewMode).toBe('satellite2d');
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(useAppStore.getState().viewMode).toBe('standard2d');
    expect(
      (await screen.findAllByText(`Satellite map: ${PROVIDER_FAILURE_REASONS.network}`)).length,
    ).toBeGreaterThan(0);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(useAppStore.getState().availability.satellite).toBeNull();
    onLine.mockRestore();
  });
});

describe('ImageryNotice', () => {
  it('Esri: provider, not live, Powered by Esri, and the verified date inside the campus', () => {
    render(<ImageryNotice provider={esriWorldImagery(FAKE_KEY)} center={[75.7032, 31.2533]} />);
    const notice = screen.getByRole('region', { name: 'About the satellite imagery' });
    expect(notice).toHaveTextContent('Esri World Imagery · not live · Powered by Esri');
    expect(notice).toHaveTextContent(ESRI_IMAGERY_DATE.statement);
    expect(notice.textContent ?? '').not.toMatch(/\blive imagery|real-time|up to date/i);
  });

  it('Esri outside the verified area: no date claimed', () => {
    render(<ImageryNotice provider={esriWorldImagery(FAKE_KEY)} center={[75.69, 31.24]} />);
    const notice = screen.getByRole('region', { name: 'About the satellite imagery' });
    expect(notice).toHaveTextContent('Capture date not verified for this part of the map.');
    expect(notice).not.toHaveTextContent('2023-12-18');
  });

  it('EOX: the 10 m warning stays visible', () => {
    render(<ImageryNotice provider={eoxSentinel2016(true)} center={[75.7032, 31.2533]} />);
    expect(screen.getByTestId('imagery-warning')).toHaveTextContent('10 m imagery — buildings not visible');
    expect(screen.getByRole('region', { name: 'About the satellite imagery' })).toHaveTextContent(
      'Sentinel-2 cloudless mosaic, 2016 (EOX).',
    );
  });
});

describe('ImageryNotice (compact, phones)', () => {
  it('folds the date into a disclosure but keeps the first line and the warning visible', async () => {
    render(<ImageryNotice provider={esriWorldImagery(FAKE_KEY)} center={[75.7032, 31.2533]} compact />);
    const notice = screen.getByRole('region', { name: 'About the satellite imagery' });
    const summary = notice.querySelector('summary')!;
    expect(summary).toHaveTextContent('Esri World Imagery · not live · Powered by Esri');
    expect(notice.querySelector('details')).not.toHaveAttribute('open');
    await userEvent.click(summary);
    expect(notice.querySelector('details')).toHaveAttribute('open');
    expect(notice).toHaveTextContent(ESRI_IMAGERY_DATE.statement);
    // Dates never break at a hyphen.
    expect(screen.getByText('2026-10-24')).toHaveClass('whitespace-nowrap');
    cleanup();
    render(<ImageryNotice provider={eoxSentinel2016(true)} center={null} compact />);
    expect(screen.getByTestId('imagery-warning')).toBeVisible();
  });
});

describe('ReturnToCampusButton', () => {
  it('asks for the whole-campus view', async () => {
    render(<ReturnToCampusButton />);
    await userEvent.click(screen.getByRole('button', { name: RETURN_TO_CAMPUS_LABEL }));
    expect(useAppStore.getState().focusRequest).toMatchObject({ kind: 'reset' });
  });
});
