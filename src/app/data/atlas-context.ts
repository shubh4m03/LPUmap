import { createContext, useContext } from 'react';
import type { AtlasServices } from './services.ts';

export const AtlasContext = createContext<AtlasServices | null>(null);

/** Loaded dataset + derived services. Only valid below <DataProvider> once data is ready. */
export function useAtlas(): AtlasServices {
  const value = useContext(AtlasContext);
  if (!value) throw new Error('useAtlas must be used inside <DataProvider> after the data has loaded.');
  return value;
}
