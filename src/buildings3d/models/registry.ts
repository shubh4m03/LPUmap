/**
 * GLB model registry: the seam of Decision D3 (docs/ISOMETRIC_AND_3D_DESIGN.md
 * §5.5). Committed data, EMPTY today: no licensed, georeferenced campus model
 * exists, so `three` is not a dependency and is never downloaded.
 *
 * An entry may only be added with a licence, a manifest source and a
 * verification date, and only after the D3 adoption gate passes (a measured
 * spike build, picking fallback and context-loss tests). Owner-authored
 * procedural studio models are NOT registry entries: they render through the
 * studio custom layer (S1).
 */
import type { LngLat } from '../../data/schema.ts';

export interface ModelEntry {
  /** Footprint this model replaces (its extrusion is filtered out while the model is shown). */
  buildingId: string;
  /** Self-hosted under public/models/ (CSP connect-src 'self'). */
  url: string;
  bytes: number;
  sha256: string;
  anchor: LngLat;
  rotationDeg: number;
  scale: number;
  licence: string;
  /** Must exist in manifest.sources. */
  sourceId: string;
  verifiedAt: string;
}

export const MODEL_REGISTRY: readonly ModelEntry[] = [];
