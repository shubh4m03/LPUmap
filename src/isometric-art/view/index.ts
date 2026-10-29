/**
 * src/isometric-art/view — the illustrated overview's renderer, detail card and
 * legend (React; docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md §8). The pure artwork
 * contracts are ../index.ts; src/app/IsometricModeStage.tsx wires this view to
 * the store and is loaded lazily.
 */
export { ArtworkDetailCard } from './ArtworkDetailCard.tsx';
export type { LinkedBuildingInfo } from './ArtworkDetailCard.tsx';
export { ArtworkLegend } from './ArtworkLegend.tsx';
export { IllustratedOverview, NARROW_PX } from './IllustratedOverview.tsx';
export type { ArtController } from './IllustratedOverview.tsx';
