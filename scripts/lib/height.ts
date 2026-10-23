/**
 * Render heights for building extrusion, plus the raw height tags as facts.
 *
 * Only an explicit `height` tag is a sourced measurement; levels ×
 * metresPerLevel is an estimate and the fallback is a placeholder — the
 * heightSource field says which. A `building:levels` value below 1 (for
 * example 0.2) is kept as the tagged fact but flagged as suspicious and NOT
 * used for rendering: such a building is drawn with the placeholder height.
 */
import { APP_CONFIG } from '../../src/config/index.ts';
import type { HeightSource } from '../../src/data/schema.ts';
import type { Tags } from './osm-parse.ts';

export interface HeightInfo {
  /** building:levels as tagged (> 0, may be fractional); null when absent/invalid. A fact, even when suspicious. */
  levels: number | null;
  /** The tagged levels value is below 1 storey (e.g. 0.2): not used for rendering. */
  levelsSuspicious: boolean;
  /** building:min_level as tagged (≥ 0), else null. */
  minLevel: number | null;
  /** OSM `height` tag in metres (> 0), else null. */
  osmHeightM: number | null;
  /** OSM `min_height` tag in metres (≥ 0), else null. */
  osmMinHeightM: number | null;
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

/** Tagged storey counts below this are implausible for a building and never drive the render height. */
export const MIN_PLAUSIBLE_LEVELS = 1;

const r2 = (v: number) => Math.round(v * 100) / 100;

export function computeHeight(
  tags: Tags,
  cfg: { metresPerLevel: number; fallbackBuildingHeightM: number } = APP_CONFIG.map,
): HeightInfo {
  const levelsRaw = parseLevels(tags['building:levels']);
  const levels = levelsRaw !== null && levelsRaw > 0 ? levelsRaw : null;
  const levelsSuspicious = levels !== null && levels < MIN_PLAUSIBLE_LEVELS;
  const taggedHeight = parseMetres(tags.height);
  const osmHeightM = taggedHeight !== null && taggedHeight > 0 ? taggedHeight : null;
  const osmMinHeightM = parseMetres(tags.min_height);
  const minLevel = parseLevels(tags['building:min_level']);
  let heightM: number;
  let heightSource: HeightSource;
  if (osmHeightM !== null) {
    heightM = osmHeightM;
    heightSource = 'osm-height';
  } else if (levels !== null && !levelsSuspicious) {
    heightM = levels * cfg.metresPerLevel;
    heightSource = 'osm-levels-estimate';
  } else {
    heightM = cfg.fallbackBuildingHeightM;
    heightSource = 'fallback';
  }
  let minHeightM = osmMinHeightM ?? (minLevel !== null ? minLevel * cfg.metresPerLevel : 0);
  let minHeightIgnored = false;
  if (minHeightM >= heightM) {
    // Inconsistent tagging (or a min level above a placeholder height): draw from the ground.
    minHeightIgnored = minHeightM > 0;
    minHeightM = 0;
  }
  return {
    levels,
    levelsSuspicious,
    minLevel,
    osmHeightM,
    osmMinHeightM,
    heightM: r2(heightM),
    minHeightM: r2(minHeightM),
    heightSource,
    minHeightIgnored,
  };
}

/** "Unnamed building" or "Unnamed building · N floors" (N only when tagged as a plausible whole number). */
export function unnamedBuildingLabel(levels: number | null): string {
  if (levels === null || !Number.isInteger(levels) || levels < MIN_PLAUSIBLE_LEVELS)
    return 'Unnamed building';
  return `Unnamed building · ${levels} ${levels === 1 ? 'floor' : 'floors'}`;
}

/** fidelityLevel from the render height source (docs/MODULE_CONTRACTS.md: 0 outline, 1 levels, 2 tagged height). */
export function fidelityOf(h: HeightInfo, cfg = APP_CONFIG.map): { level: 0 | 1 | 2; reason: string } {
  if (h.heightSource === 'osm-height')
    return { level: 2, reason: `Height tagged in OpenStreetMap (height = ${h.osmHeightM} m).` };
  if (h.heightSource === 'osm-levels-estimate')
    return {
      level: 1,
      reason: `Height estimated from building:levels = ${h.levels} × ${cfg.metresPerLevel} m per storey; no measured height.`,
    };
  if (h.levelsSuspicious)
    return {
      level: 0,
      reason:
        `Levels tagged ${h.levels} (suspicious: below ${MIN_PLAUSIBLE_LEVELS} storey); drawn with the ` +
        `${cfg.fallbackBuildingHeightM} m placeholder height.`,
    };
  return {
    level: 0,
    reason: `Footprint only: no height or building:levels tag; drawn with the ${cfg.fallbackBuildingHeightM} m placeholder height.`,
  };
}
