import { APP_CONFIG } from '../../config/index.ts';

const OPTIONAL = APP_CONFIG.optionalLayers;

/** What the two opt-in layers are; both are off by default and never part of the campus lists. */
export const OPTIONAL_LAYER_TEXT = {
  nearbyOutsideCampus: `Places just outside the campus boundary. Each is marked “${OPTIONAL.nearbyOutsideCampus.badge}”, is searchable only while this is on, and is never counted as a campus place or listed in the building directory. Drawn on the 3D and 2D maps.`,
  detectedFootprints:
    'Building outlines detected by machine learning in imagery (Microsoft Global ML Building Footprints, Google Open Buildings). Drawn flat with a dashed outline on the 3D and 2D maps; not checked on the ground and not part of the campus building list.',
} as const;
