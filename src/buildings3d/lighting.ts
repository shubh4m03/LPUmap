/**
 * Map-anchored light for Realistic 3D (D1 enhancement 2). With MapLibre's
 * default `anchor: 'viewport'` the "sun" turns with the camera; anchoring
 * it to the map keeps each façade's shading fixed while the user rotates.
 *
 * The values are a visual tuning choice inside the design's ranges
 * (azimuth 200–225°, polar 30–40°, intensity 0.5 light / ~0.35 dark). They
 * are NOT a physical claim about the sun at the campus. The studio custom
 * layer reads the same object, so studio models and extrusions are lit alike.
 */
import type { LightSpecification } from 'maplibre-gl';
import type { MapTheme } from '../styles/index.ts';
import { realistic3dColors } from './palette.ts';

export const LIGHT_AZIMUTH_DEG = 210;
export const LIGHT_POLAR_DEG = 35;
export const LIGHT_INTENSITY: Readonly<Record<MapTheme, number>> = { light: 0.5, dark: 0.35 };

export interface RealisticLight {
  anchor: 'map';
  position: [number, number, number];
  intensity: number;
  color: string;
}

export function realisticLight(theme: MapTheme): RealisticLight {
  return {
    anchor: 'map',
    position: [1.15, LIGHT_AZIMUTH_DEG, LIGHT_POLAR_DEG],
    intensity: LIGHT_INTENSITY[theme],
    color: realistic3dColors(theme).light,
  };
}

/** The same light as a MapLibre style `light` (set in the style and with map.setLight). */
export function lightSpecification(theme: MapTheme): LightSpecification {
  return { ...realisticLight(theme) };
}
