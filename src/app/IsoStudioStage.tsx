import { useCallback, useMemo } from 'react';
import { IsoStage } from './IsoStage.tsx';
import { isoStudioModel } from '../isometric/studio.ts';
import type { MapPadding } from '../map/index.ts';
import { useAtlas } from './data/atlas-context.ts';
import { useAppStore } from './store/index.ts';

export interface IsoStudioStageProps {
  theme: 'light' | 'dark';
  reducedMotion: boolean;
  padding: MapPadding;
}

/**
 * The overview with the published owner-placed models (S1: the SAME faces as
 * Realistic 3D; a model this build cannot generate is drawn as its footprint
 * prism, never dropped). Its own chunk, so the mesh generator loads only when
 * the overview is shown.
 */
export function IsoStudioStage({ theme, reducedMotion, padding }: IsoStudioStageProps) {
  const { studioModels } = useAtlas();
  const models = useMemo(
    () => studioModels.map((m) => isoStudioModel(m, { baseFootprint: m.footprint.coordinates })),
    [studioModels],
  );
  const openDirectory = useCallback(() => useAppStore.getState().openPanel('directory'), []);
  // The details panel already shows the selected building with its labels: on a phone the
  // overview's own card would only cover the centred building above the sheet.
  const detailsOpen = useAppStore((s) => s.activePanel === 'details');
  return (
    <IsoStage
      theme={theme}
      reducedMotion={reducedMotion}
      padding={padding}
      studioModels={models}
      onOpenDirectory={openDirectory}
      narrowInfoCard={!detailsOpen}
    />
  );
}
