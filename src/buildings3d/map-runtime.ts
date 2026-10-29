/**
 * src/buildings3d — the map-only entry: the realistic-3D controller, the
 * optional layers and the owner-model seam. Imported only by the lazily
 * loaded map (src/map), never by the start-up chunk; ./index.ts is the light
 * entry the app shell uses (WebGL probe, layer ids, 2D/3D mode).
 */
export { detectionAttributionHtml } from './optional-layers.ts';
export { attachRealistic3D } from './realistic3d.ts';
export type { Realistic3DDebug, Realistic3DHandle, RenderNotice } from './realistic3d.ts';
