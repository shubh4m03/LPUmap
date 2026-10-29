/**
 * The isometric mode stage: the illustrated variant by default, the
 * map-accurate drawing on request or when the artwork is unavailable (with the
 * reason shown, never a blank stage), the variant mirrored in `?iso=`, and the
 * app selection shared by id (an artwork selection uses its `art:` id; a
 * building selection highlights only VERIFIED joins).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AtlasContext } from '../../../src/app/data/atlas-context.ts';
import type { AtlasServices } from '../../../src/app/data/services.ts';
import { getMapController } from '../../../src/app/map-controller.ts';
import { useAppStore } from '../../../src/app/store/index.ts';
import { ToastProvider } from '../../../src/components/ui/index.ts';
import { mergeArtworkAssociations } from '../../../src/isometric-art/associations.ts';
import { IsometricModeStage } from '../../../src/app/IsometricModeStage.tsx';
import {
  getRequestedIsometricVariant,
  resetRequestedIsometricVariant,
} from '../../../src/app/isometric-variant.ts';
import { NO_INSETS } from '../../../src/isometric-art/viewport.ts';
import { loadManifest } from './renderer-fixtures.ts';

const manifest = loadManifest();
const associations = mergeArtworkAssociations({
  subjectIds: manifest.subjects.map((s) => s.subjectId),
  baseline: manifest.associations,
  decisions: [],
  buildingExists: () => true,
}).bySubject;

function services(artwork: Partial<AtlasServices['artwork']>): AtlasServices {
  return {
    getPlace: () => undefined,
    directory: { isRoutable: () => false },
    buildingDirectory: { byId: new Map() },
    artwork: {
      manifest: null,
      unavailableReason: null,
      associations: new Map(),
      issues: [],
      directory: null,
      hotspotsBySubject: new Map(),
      subjectOfHotspot: () => undefined,
      ...artwork,
    },
  } as unknown as AtlasServices;
}

function renderStage(svc: AtlasServices): void {
  const wrap = (node: ReactNode) => (
    <ToastProvider>
      <AtlasContext.Provider value={svc}>{node}</AtlasContext.Provider>
    </ToastProvider>
  );
  render(
    wrap(
      <IsometricModeStage
        reducedMotion
        padding={NO_INSETS}
        renderMapAccurate={(p) => <div data-testid="map-accurate" data-top={p.top} />}
      />,
    ),
  );
}

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 1280,
    height: 800,
    right: 1280,
    bottom: 800,
    toJSON: () => ({}),
  } as DOMRect);
  window.history.replaceState(null, '', '/?view=iso');
  resetRequestedIsometricVariant(null);
  useAppStore.setState({ selectedPlaceId: null, focusRequest: null });
});
afterEach(() => {
  cleanup();
});

describe('IsometricModeStage', () => {
  it('shows the illustrated overview by default and registers its controller with the app', () => {
    renderStage(services({ manifest, associations }));
    expect(screen.getByTestId('art-view')).toBeInTheDocument();
    expect(screen.queryByTestId('map-accurate')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Illustrated' })).toHaveAttribute('aria-checked', 'true');
    const c = getMapController();
    expect(c).not.toBeNull();
    // Geographic camera moves never land on the illustration (it is not geographically exact).
    expect(() => c!.flyTo([75.7, 31.25], 17)).not.toThrow();
  });

  it('switching to Map-accurate shows the footprint drawing below the switch and writes ?iso=map', () => {
    renderStage(services({ manifest, associations }));
    fireEvent.click(screen.getByRole('radio', { name: 'Map-accurate' }));
    expect(getRequestedIsometricVariant()).toBe('map-accurate');
    expect(window.location.search).toContain('iso=map');
    expect(screen.getByTestId('map-accurate').dataset.top).toBe('56');
    fireEvent.click(screen.getByRole('radio', { name: 'Illustrated' }));
    expect(window.location.search).toContain('iso=art');
    expect(screen.getByTestId('art-view')).toBeInTheDocument();
  });

  it('falls back to the map-accurate drawing with the reason when the artwork is unavailable', () => {
    renderStage(
      services({ manifest: null, unavailableReason: 'The campus illustration could not be loaded.' }),
    );
    expect(screen.getByTestId('map-accurate')).toBeInTheDocument();
    expect(screen.getByTestId('art-unavailable')).toHaveTextContent('could not be loaded');
    expect(screen.getByRole('radio', { name: 'Illustrated' })).toBeDisabled();
  });

  it('falls back when the artwork image fails to load', () => {
    renderStage(services({ manifest, associations }));
    const base = screen.getByTestId('art-layer').querySelector('img[data-art-purpose]')!;
    fireEvent.error(base);
    expect(screen.getByTestId('map-accurate')).toBeInTheDocument();
    expect(screen.getByTestId('art-unavailable')).toBeInTheDocument();
  });

  it('a hotspot selection becomes the app selection by its art: id and shows the detail card', () => {
    renderStage(services({ manifest, associations }));
    const poly = screen
      .getByTestId('art-outlines')
      .querySelector<SVGPolygonElement>('polygon[data-hotspot-id="hs-pin-25"]')!;
    fireEvent.keyDown(poly, { key: 'Enter' });
    expect(useAppStore.getState().selectedPlaceId).toBe('art:num-25');
    expect(screen.getByTestId('art-detail-card')).toBeInTheDocument();
    // Selecting from elsewhere (search, directory) highlights the same outline.
    act(() => useAppStore.setState({ selectedPlaceId: 'art:num-15' }));
    expect(
      screen.getByTestId('art-selection').querySelector('[data-selected-hotspot-id="hs-pin-15"]'),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(useAppStore.getState().selectedPlaceId).toBeNull();
  });

  it('with the details panel open for the item there is no second card beside it (desktop too)', () => {
    renderStage(services({ manifest, associations }));
    act(() => useAppStore.setState({ selectedPlaceId: 'art:num-25', activePanel: 'details' }));
    expect(screen.queryByTestId('art-detail-card')).not.toBeInTheDocument();
    act(() => useAppStore.setState({ activePanel: 'none' }));
    expect(screen.getByTestId('art-detail-card')).toBeInTheDocument();
  });

  it('an approximate candidate building selected elsewhere highlights nothing (no identity join)', () => {
    renderStage(services({ manifest, associations }));
    const approx = manifest.associations.find((a) => a.status === 'approximate')!;
    act(() => useAppStore.setState({ selectedPlaceId: approx.buildingId }));
    expect(screen.getByTestId('art-selection').children).toHaveLength(0);
  });
});

describe('camera carrying across the illustration', () => {
  it('map → illustration → map-accurate keeps the map ground point; the illustration never takes it', async () => {
    const mc = await import('../../../src/app/map-controller.ts');
    mc.resetCarriedCamera();
    const fly = vi.fn();
    const map = {
      flyTo: vi.fn(),
      follow: vi.fn(),
      fitCoordinates: vi.fn(),
      resetView: vi.fn(),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      resetNorth: vi.fn(),
      setPadding: vi.fn(),
      getCamera: () => ({
        center: [75.7, 31.25] as [number, number],
        zoom: 17,
        pitch: 0,
        bearing: 0,
        padding: NO_INSETS,
      }),
    };
    mc.setMapController(map);
    mc.carryCamera(); // leaving the map
    mc.setMapController(null);
    const art = { ...map, flyTo: fly, getCamera: undefined };
    mc.setMapController(art, { geographic: false });
    expect(fly).not.toHaveBeenCalled();
    mc.carryCamera(); // leaving the illustration: nothing to carry, the map's camera is kept
    mc.setMapController(null);
    const iso = { ...map, flyTo: vi.fn() };
    mc.setMapController(iso);
    expect(iso.flyTo).toHaveBeenCalledWith([75.7, 31.25], 17);
    mc.setMapController(null);
  });
});
