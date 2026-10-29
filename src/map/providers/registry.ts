/**
 * Provider registry and capability detection (docs/MAP_PROVIDER_CONFIGURATION.md §Modes).
 * Pure functions over the build configuration plus the runtime state
 * (`ImageryRuntime`: a failure seen this session, online/offline). They decide
 * which imagery, if any, each view mode draws and what the mode switcher says.
 *
 * Terrain: none. Campus relief measured from Copernicus GLO-30 (2026-10-24) is
 * about 5 m of ground-level variation over 1.1 × 1.7 km (≈0.3 % slope) —
 * invisible in a 3D view — and GLO-30 is a surface model that would lift the
 * ground under buildings and trees. See MAP_PROVIDER_CONFIGURATION.md §Terrain.
 */
import type { ProviderConfig } from './config.ts';
import { ESRI_ORIGIN, esriWorldImagery } from './esri.ts';
import { EOX_ORIGIN, eoxSentinel2016 } from './eox.ts';
import {
  PHOTOREAL_PROVIDER,
  PHOTOREAL_UNAVAILABLE_REASON,
  PROVIDER_FAILURE_REASONS,
  SATELLITE_NOT_CONFIGURED_REASON,
  type CapabilityReport,
  type ImageryProvider,
  type ProviderFailure,
  type ProviderRegistry,
  type ProviderStatus,
  type ViewModeAvailability,
} from './types.ts';

/** Every third-party origin any build may contact (public/_headers connect-src must list exactly these). */
export const IMAGERY_ORIGINS: readonly string[] = [ESRI_ORIGIN, EOX_ORIGIN];

/** Configured imagery in preference order: Esri (0.31 m) before the EOX 10 m backdrop. */
export function createProviderRegistry(config: ProviderConfig): ProviderRegistry {
  const imagery = [esriWorldImagery(config.arcgisApiKey), eoxSentinel2016(config.eoxBackdrop)].filter((p) =>
    p.configured(),
  );
  return { imagery, photoreal: PHOTOREAL_PROVIDER, terrain: null };
}

/** The imagery a build uses (the first configured provider), or null. */
export function primaryImagery(registry: ProviderRegistry): ImageryProvider | null {
  return registry.imagery[0] ?? null;
}

/** Runtime facts that can make configured imagery unusable. */
export interface ImageryRuntime {
  /** A failure seen this session (auth and quota persist; network clears when back online). */
  failure: ProviderFailure | null;
  online: boolean;
}

export const HEALTHY_RUNTIME: ImageryRuntime = { failure: null, online: true };

export function imageryStatus(registry: ProviderRegistry, runtime: ImageryRuntime): ProviderStatus {
  const p = primaryImagery(registry);
  if (!p)
    return {
      state: 'failed',
      failure: 'not-configured',
      reason: SATELLITE_NOT_CONFIGURED_REASON,
      providerId: null,
    };
  const failure: ProviderFailure | null = runtime.failure ?? (runtime.online ? null : 'network');
  if (failure)
    return { state: 'failed', failure, reason: PROVIDER_FAILURE_REASONS[failure], providerId: p.id };
  return { state: 'available', providerId: p.id };
}

/** What the mode switcher shows for the provider-backed modes. */
export function viewModeAvailability(
  registry: ProviderRegistry,
  runtime: ImageryRuntime,
): ViewModeAvailability {
  const status = imageryStatus(registry, runtime);
  return {
    satellite: status.state === 'failed' ? status.reason : null,
    photoreal: PHOTOREAL_UNAVAILABLE_REASON,
  };
}

/**
 * The imagery drawn in `mode` (a `ViewMode` of src/app/view-mode.ts): Satellite
 * 2D needs it; Campus 3D uses it only when it shows buildings ('high' detail);
 * every other mode draws none.
 */
export function imageryForMode(
  mode: string,
  registry: ProviderRegistry,
  runtime: ImageryRuntime,
): ImageryProvider | null {
  if (mode !== 'satellite2d' && mode !== 'realistic3d') return null;
  if (imageryStatus(registry, runtime).state !== 'available') return null;
  const p = primaryImagery(registry);
  if (!p) return null;
  if (mode === 'realistic3d' && p.detail !== 'high') return null;
  return p;
}

export function capabilityReport(
  registry: ProviderRegistry,
  runtime: ImageryRuntime,
  webgl: boolean,
): CapabilityReport {
  const imagery = webgl
    ? imageryStatus(registry, runtime)
    : ({
        state: 'failed',
        failure: 'unsupported',
        reason: PROVIDER_FAILURE_REASONS.unsupported,
        providerId: primaryImagery(registry)?.id ?? null,
      } as const);
  return {
    webgl,
    online: runtime.online,
    imagery,
    photoreal: {
      state: 'failed',
      failure: 'unavailable',
      reason: registry.photoreal.reason,
      providerId: null,
    },
    terrain: null,
  };
}
