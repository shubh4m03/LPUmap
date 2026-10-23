import { render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';
import { LiveRegion } from '../../../src/accessibility/index.ts';
import { AtlasContext } from '../../../src/app/data/atlas-context.ts';
import { buildServices, type AtlasServices } from '../../../src/app/data/services.ts';
import { useAppStore } from '../../../src/app/store/index.ts';
import { ToastProvider } from '../../../src/components/ui/index.ts';
import { syntheticCampus } from './synthetic-campus.ts';

const initialState = useAppStore.getState();

/** Restores the singleton app store between tests. */
export function resetAppStore(): void {
  useAppStore.setState(initialState, true);
}

export function syntheticServices(): AtlasServices {
  return buildServices(syntheticCampus());
}

export function renderWithAtlas(
  ui: ReactNode,
  services = syntheticServices(),
): RenderResult & { services: AtlasServices } {
  const result = render(
    <ToastProvider>
      <AtlasContext.Provider value={services}>{ui}</AtlasContext.Provider>
      <LiveRegion />
    </ToastProvider>,
  );
  return { ...result, services };
}
