/**
 * The provider registry of THIS build, from the build env. Kept free of
 * MapLibre imports: the store and the privacy text read it in the main chunk.
 * Warnings name the variable only, never its value.
 */
import { parseProviderEnv } from './config.ts';
import { createProviderRegistry, HEALTHY_RUNTIME, viewModeAvailability } from './registry.ts';

// Plain Node has no import.meta.env: the Playwright specs import app modules (src/app/view-mode.ts)
// that reach this file through the providers entry, and must load without imagery configured.
const HAS_BUILD_ENV = typeof import.meta.env === 'object';

export const BUILD_PROVIDER_CONFIG = parseProviderEnv({
  // Literal property reads so Vite replaces exactly these two variables at build time.
  VITE_ARCGIS_API_KEY: HAS_BUILD_ENV
    ? (import.meta.env.VITE_ARCGIS_API_KEY as string | undefined)
    : undefined,
  VITE_EOX_BACKDROP: HAS_BUILD_ENV ? (import.meta.env.VITE_EOX_BACKDROP as string | undefined) : undefined,
});

for (const warning of BUILD_PROVIDER_CONFIG.warnings) console.warn(`[map providers] ${warning}`);

export const BUILD_PROVIDERS = createProviderRegistry(BUILD_PROVIDER_CONFIG);

/** Availability before anything has been tried at runtime (assumes online; the app updates it). */
export const BUILD_VIEW_MODE_AVAILABILITY = viewModeAvailability(BUILD_PROVIDERS, HEALTHY_RUNTIME);
