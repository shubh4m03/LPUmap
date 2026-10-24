/**
 * Studio renderer for Realistic 3D (S1). This module is safe to import from
 * the main bundle: it holds types and the lazy loader only. The WebGL2 layer
 * and mesh generation live in ./runtime.ts, a separate chunk fetched when at
 * least one visible studio instance exists or the Studio is open.
 */
import type * as Runtime from './runtime.ts';

export type {
  StudioCustomLayer,
  StudioLayerFailure,
  StudioLayerInstance,
  StudioLayerOptions,
  StudioLayerStats,
  StudioLayerStyle,
  StudioLight,
} from './layer.ts';
export type { StudioAppearance } from './buffers.ts';
export type { StudioInstanceResult, StudioRenderSource } from './instances.ts';

export type StudioRendererModule = typeof Runtime;

/** Loads the custom-layer chunk. */
export function loadStudioRenderer(): Promise<StudioRendererModule> {
  return import('./runtime.ts');
}
