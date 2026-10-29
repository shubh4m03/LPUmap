/**
 * Realistic-3D colours that are not in the shared map palette
 * (src/styles/map-theme-colors.ts): the honest class for owner-placed studio models
 * drawn as fallback extrusions, the "Unverified detected footprints" layer,
 * the "Outside campus" badge, the glass tone of procedural windows, and the
 * map-anchored light. Hex values so tests can check contrast.
 */
import type { MapTheme } from '../styles/index.ts';

export interface Realistic3DColors {
  /** Fallback extrusion of an owner-placed studio model (cool tone: not OSM data). */
  extrusionStudio: string;
  /** Dashed outline of a machine-detected footprint (must reach 3:1 on the campus ground). */
  detectionOutline: string;
  /** Very light fill under the dashed outline. */
  detectionFill: string;
  /** Text of the "Outside campus" badge and its halo. */
  badgeText: string;
  badgeHalo: string;
  /** Glass of procedural studio windows (appearance only). */
  glass: string;
  /** Map-anchored light colour. */
  light: string;
}

export const REALISTIC_3D_COLORS: Readonly<Record<MapTheme, Realistic3DColors>> = {
  light: {
    extrusionStudio: '#a9bccc',
    detectionOutline: '#7c3aed',
    detectionFill: '#7c3aed',
    badgeText: '#57534e',
    badgeHalo: '#f8f6f1',
    glass: '#4b5d70',
    light: '#ffffff',
  },
  dark: {
    extrusionStudio: '#4a5f73',
    detectionOutline: '#c4b5fd',
    detectionFill: '#a78bfa',
    badgeText: '#d6d3d1',
    badgeHalo: '#0b0f14',
    glass: '#22313f',
    light: '#ffffff',
  },
};

export function realistic3dColors(theme: MapTheme): Realistic3DColors {
  return REALISTIC_3D_COLORS[theme];
}
