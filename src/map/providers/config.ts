/**
 * Build-time provider settings (docs/MAP_PROVIDER_CONFIGURATION.md §Modes).
 * Pure: reads an env-like object, makes no request, never throws, and never
 * puts a key value into a warning (a warning names the variable only).
 *
 *   VITE_ARCGIS_API_KEY   ArcGIS Location Platform API key (free tier, no billing; referrer-restricted).
 *                         Set it only in .env.local or the host's build env — never commit it.
 *                         Unset/empty = no Esri imagery.
 *   VITE_EOX_BACKDROP     'true' enables the keyless EOX Sentinel-2 cloudless 2016 backdrop
 *                         (10 m, low zoom only). Unset = off.
 */
import { z } from 'zod';

export interface ProviderEnv {
  readonly VITE_ARCGIS_API_KEY?: string | undefined;
  readonly VITE_EOX_BACKDROP?: string | undefined;
}

export interface ProviderConfig {
  /** The ArcGIS key, or null when not set or not plausible. */
  arcgisApiKey: string | null;
  /** The EOX Sentinel-2 2016 backdrop is enabled. */
  eoxBackdrop: boolean;
  /** Configuration problems (variable names only, never values). */
  warnings: string[];
}

/** ArcGIS API keys are long URL-safe tokens; anything else is a typo or a placeholder. */
const keySchema = z
  .string()
  .regex(/^[A-Za-z0-9._~-]+$/)
  .min(20)
  .max(4096);

/** Placeholders copied from Esri tutorials or .env examples. */
const PLACEHOLDER = /^(your[_-]?(api[_-]?key|access[_-]?token)|changeme|replace[_-]?me|xxx+)$/i;

const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);
const FALSE_VALUES = new Set(['', 'false', '0', 'no', 'off']);

export function parseProviderEnv(env: ProviderEnv): ProviderConfig {
  const warnings: string[] = [];

  let arcgisApiKey: string | null = null;
  const rawKey = (env.VITE_ARCGIS_API_KEY ?? '').trim();
  if (rawKey !== '') {
    if (PLACEHOLDER.test(rawKey) || !keySchema.safeParse(rawKey).success) {
      warnings.push(
        'VITE_ARCGIS_API_KEY is set but does not look like an ArcGIS API key; satellite imagery stays off.',
      );
    } else {
      arcgisApiKey = rawKey;
    }
  }

  const rawEox = (env.VITE_EOX_BACKDROP ?? '').trim().toLowerCase();
  const eoxBackdrop = TRUE_VALUES.has(rawEox);
  if (!eoxBackdrop && !FALSE_VALUES.has(rawEox)) {
    warnings.push('VITE_EOX_BACKDROP must be "true" or "false"; the EOX backdrop stays off.');
  }

  return { arcgisApiKey, eoxBackdrop, warnings };
}
