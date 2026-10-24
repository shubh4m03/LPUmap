/**
 * The lazily loaded part of the studio renderer (one chunk): the WebGL2
 * custom layer and the record → mesh adapter. Import it only through
 * `loadStudioRenderer()` in ./index.ts so the public entry bundle never
 * contains WebGL or mesh-generator code.
 */
export { createStudioCustomLayer, STUDIO_LAYER_ID } from './layer.ts';
export { studioInstanceFor, clearStudioInstanceMemo } from './instances.ts';
