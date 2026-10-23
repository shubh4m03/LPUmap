/**
 * Single home for tunable values: branding, map view, routing speeds, GPS and
 * tracking thresholds, performance budgets and cache versions. Validated at
 * startup by `validateConfig()` (called from src/main.tsx) so a bad edit fails
 * loudly instead of producing subtly wrong distances.
 *
 * Shared with scripts/: erasable syntax and `.ts` import extensions only.
 */
import { z } from 'zod';

export const APP_CONFIG = {
  brand: {
    name: 'LPU Campus Atlas',
    shortName: 'Campus Atlas',
    institution: 'Lovely Professional University',
    location: 'Phagwara, Punjab, India',
    description:
      'Campus map, search and walking directions for Lovely Professional University, built from open, attributed data.',
    themeColor: '#c2410c',
    backgroundColor: '#0b0f14',
    officialSite: 'https://www.lpu.in/',
    repositoryUrl: '',
  },
  map: {
    /** [lon, lat] — centroid of OSM relation 21599790's extent. */
    center: [75.7032, 31.2533] as [number, number],
    zoom: 15.4,
    minZoom: 13,
    maxZoom: 20,
    /** Panning limit [w, s, e, n]: campus extent plus margin for nearby Law Gate area. */
    maxBounds: [75.685, 31.236, 75.722, 31.27] as [number, number, number, number],
    pitch3d: 55,
    bearing3d: -20,
    /** Below this zoom 3D extrusions are hidden (flat footprints only). */
    extrusionMinZoom: 14.5,
    labelMinZoom: 16,
    /** Fallback render height for buildings without height/levels — NOT a measurement. */
    fallbackBuildingHeightM: 6,
    /** Storey-to-metre conversion for building:levels — an ESTIMATE, documented as such. */
    metresPerLevel: 3.2,
  },
  routing: {
    /** Average walking speed, m/s (≈4.7 km/h). Source: common pedestrian planning value. */
    walkSpeedMps: 1.3,
    /** Leisurely campus cycling speed, m/s (≈15 km/h). */
    cycleSpeedMps: 4.2,
    /** Speed while pushing a bicycle on foot-only segments, m/s. */
    pushBikeSpeedMps: 1.1,
    /** Extra seconds charged per metre of steps when walking (climbing is slower). */
    stepsPenaltySecPerM: 0.8,
    /** Max straight-line distance to snap an arbitrary point onto the path network. */
    maxSnapDistanceM: 80,
    /** Max connector length the pipeline will infer from a place to the graph. */
    maxPlaceConnectorM: 60,
    /** Alternatives must differ by at least this share of edges to be offered. */
    alternativeMinDifference: 0.3,
    maxAlternatives: 2,
  },
  geolocation: {
    timeoutMs: 15000,
    maximumAgeMs: 5000,
    /** Samples worse than this are shown as low-accuracy and not used for progress. */
    maxAcceptedAccuracyM: 50,
    /** A fix older than this is stale. */
    staleAfterMs: 30000,
  },
  tracking: {
    /** Implied speed above this is an implausible jump (≈29 km/h). */
    maxPlausibleSpeedMps: 8,
    /** Movement below max(minStepM, accuracy × accuracyFactor) is treated as jitter. */
    minStepM: 4,
    accuracyFactor: 0.6,
    /** Off-route if farther than max(offRouteBaseM, accuracy) from the route … */
    offRouteBaseM: 30,
    /** … for this many consecutive accepted samples. */
    offRouteConsecutive: 3,
    arrivalRadiusM: 20,
    arrivalConsecutive: 2,
    /** Below this average speed the user is reported as stationary. */
    stationarySpeedMps: 0.3,
  },
  search: {
    maxResults: 20,
    debounceMs: 60,
    maxRecent: 8,
  },
  performance: {
    /** Targets (not guarantees) recorded in docs/PERFORMANCE.md. */
    searchBudgetMs: 50,
    routeBudgetMs: 150,
  },
  storage: {
    /** Bump to invalidate incompatible localStorage payloads. */
    version: 1,
    prefix: 'lpu-atlas',
  },
  cache: {
    /** Service-worker data cache name; bump with DATA_SCHEMA_VERSION. */
    dataCache: 'lpu-atlas-data-v1',
    /** Hours after which cached opening hours show a freshness warning. */
    hoursFreshnessDays: 180,
  },
} as const;

const positive = z.number().positive();

const configSchema = z.object({
  brand: z
    .object({ name: z.string().min(1), shortName: z.string().min(1), themeColor: z.string().regex(/^#/) })
    .loose(),
  map: z
    .object({
      center: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
      zoom: positive,
      minZoom: z.number().nonnegative(),
      maxZoom: positive,
      maxBounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
      fallbackBuildingHeightM: positive,
      metresPerLevel: positive,
    })
    .loose()
    .refine((m) => m.minZoom < m.zoom && m.zoom < m.maxZoom, 'zoom must lie between minZoom and maxZoom')
    .refine(
      (m) =>
        m.maxBounds[0] < m.center[0] &&
        m.center[0] < m.maxBounds[2] &&
        m.maxBounds[1] < m.center[1] &&
        m.center[1] < m.maxBounds[3],
      'center must lie inside maxBounds',
    ),
  routing: z
    .object({
      walkSpeedMps: positive,
      cycleSpeedMps: positive,
      pushBikeSpeedMps: positive,
      maxSnapDistanceM: positive,
      maxPlaceConnectorM: positive,
    })
    .loose(),
  geolocation: z
    .object({ timeoutMs: positive, maxAcceptedAccuracyM: positive, staleAfterMs: positive })
    .loose(),
  tracking: z
    .object({
      maxPlausibleSpeedMps: positive,
      minStepM: positive,
      offRouteBaseM: positive,
      offRouteConsecutive: z.number().int().positive(),
      arrivalRadiusM: positive,
      arrivalConsecutive: z.number().int().positive(),
    })
    .loose(),
});

export type AppConfig = typeof APP_CONFIG;

/** Throws with a readable message when the configuration is inconsistent. */
export function validateConfig(config: unknown = APP_CONFIG): void {
  const result = configSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Invalid APP_CONFIG: ${z.prettifyError(result.error)}`);
  }
}
