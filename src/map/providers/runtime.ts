/**
 * The provider registry of THIS build, from the build env. Kept free of
 * MapLibre imports: the store and the privacy text read it in the main chunk.
 * Warnings name the variable only, never its value.
 */
import { parseProviderEnv } from './config.ts';
import { createProviderRegistry, HEALTHY_RUNTIME, viewModeAvailability } from './registry.ts';

export const BUILD_PROVIDER_CONFIG = parseProviderEnv({
  // Literal property reads so Vite replaces exactly these two variables at build time.
  VITE_ARCGIS_API_KEY: import.meta.env.VITE_ARCGIS_API_KEY as string | undefined,
  VITE_EOX_BACKDROP: import.meta.env.VITE_EOX_BACKDROP as string | undefined,
});

for (const warning of BUILD_PROVIDER_CONFIG.warnings) console.warn(`[map providers] ${warning}`);

export const BUILD_PROVIDERS = createProviderRegistry(BUILD_PROVIDER_CONFIG);

/** Availability before anything has been tried at runtime (assumes online; the app updates it). */
export const BUILD_VIEW_MODE_AVAILABILITY = viewModeAvailability(BUILD_PROVIDERS, HEALTHY_RUNTIME);
