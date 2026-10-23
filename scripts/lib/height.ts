/**
 * Render heights for building extrusion. Only an explicit `height` tag is a
 * sourced measurement; levels × metresPerLevel is an estimate and the
 * fallback is a placeholder — the heightSource field says which.
 */
import { APP_CONFIG } from '../../src/config/index.ts';
import type { HeightSource } from '../../src/data/schema.ts';
import type { Tags } from './osm-parse.ts';

export interface HeightInfo {
  /** building:levels as tagged (may be fractional), null when absent/invalid. */
  levels: number | null;
  heightM: number;
  minHeightM: number;
  heightSource: HeightSource;
  /** Set when min_height/min_level was ignored because it was not below the top. */
  minHeightIgnored: boolean;
}

/** Parses a metre value: "12", "12.5", "12 m", "12m". Feet and other units are rejected. */
export function parseMetres(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:m)?\s*$/.exec(raw);
  if (!m?.[1]) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

/** Parses a non-negative storey count ("4", "2.5"). */
export function parseLevels(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*$/.exec(raw);
  if (!m?.[1]) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function computeHeight(
  tags: Tags,
  cfg: { metresPerLevel: number; fallbackBuildingHeightM: number } = APP_CONFIG.map,
): HeightInfo {
  const levelsRaw = parseLevels(tags['building:levels']);
  const levels = levelsRaw !== null && levelsRaw > 0 ? levelsRaw : null;
  const tagged = parseMetres(tags.height);
  let heightM: number;
  let heightSource: HeightSource;
  if (tagged !== null && tagged > 0) {
    heightM = tagged;
    heightSource = 'osm-height';
  } else if (levels !== null) {
    heightM = levels * cfg.metresPerLevel;
    heightSource = 'osm-levels-estimate';
  } else {
    heightM = cfg.fallbackBuildingHeightM;
    heightSource = 'fallback';
  }
  const minTagged = parseMetres(tags.min_height);
  const minLevel = parseLevels(tags['building:min_level']);
  let minHeightM = minTagged ?? (minLevel !== null ? minLevel * cfg.metresPerLevel : 0);
  let minHeightIgnored = false;
  if (minHeightM >= heightM) {
    // Inconsistent tagging (or a min level above a placeholder height): draw from the ground.
    minHeightIgnored = minHeightM > 0;
    minHeightM = 0;
  }
  return { levels, heightM: r2(heightM), minHeightM: r2(minHeightM), heightSource, minHeightIgnored };
}

/** "Unnamed building" or "Unnamed building · N floors" (N only when tagged as a whole number). */
export function unnamedBuildingLabel(levels: number | null): string {
  if (levels === null || !Number.isInteger(levels)) return 'Unnamed building';
  return `Unnamed building · ${levels} ${levels === 1 ? 'floor' : 'floors'}`;
}
