/** The details landmark names an illustration item by its exact printed title (not a generic "Place details"). */
import { cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { AtlasContext } from '../../../src/app/data/atlas-context.ts';
import type { AtlasServices } from '../../../src/app/data/services.ts';
import { useAppStore } from '../../../src/app/store/index.ts';
import { ILLUSTRATION_DETAILS_LABEL, usePanelLabel } from '../../../src/components/layout/panel-titles.ts';

const initial = useAppStore.getState();
afterEach(() => {
  cleanup();
  useAppStore.setState(initial, true);
});

function wrapper(svc: AtlasServices) {
  return ({ children }: { children: ReactNode }) => (
    <AtlasContext.Provider value={svc}>{children}</AtlasContext.Provider>
  );
}

const svc = {
  getPlace: (id: string) => (id === 'osm:way/1' ? { displayName: 'Block 34' } : undefined),
  buildingDirectory: {
    artwork: { byId: new Map([['art:num-15', { title: 'CAMPUS CAFE  &' }]]) },
  },
} as unknown as AtlasServices;

describe('usePanelLabel (details)', () => {
  it('uses the exact printed title of an illustration item, double space kept', () => {
    useAppStore.setState({ selectedPlaceId: 'art:num-15' });
    const { result } = renderHook(() => usePanelLabel('details'), { wrapper: wrapper(svc) });
    expect(result.current).toBe(`CAMPUS CAFE  &, ${ILLUSTRATION_DETAILS_LABEL}`);
  });

  it('keeps the place name for a building, and the generic title for an unknown id', () => {
    useAppStore.setState({ selectedPlaceId: 'osm:way/1' });
    expect(renderHook(() => usePanelLabel('details'), { wrapper: wrapper(svc) }).result.current).toBe(
      'Block 34, place details',
    );
    useAppStore.setState({ selectedPlaceId: 'art:num-999' });
    expect(renderHook(() => usePanelLabel('details'), { wrapper: wrapper(svc) }).result.current).toBe(
      'Place details',
    );
  });
});
