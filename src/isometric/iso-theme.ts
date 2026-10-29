/**
 * Palette roles of the isometric overview (docs/ISOMETRIC_AND_3D_DESIGN.md §6.5).
 *
 * The roles follow the visual language of the owner's reference illustration
 * (warm brick walls, light roofs, green grounds, dark roads, crisp edges,
 * clean labels) but every value is our own, chosen next to the design tokens
 * in src/styles/tokens.css and src/styles/map-theme-colors.ts. No value is sampled
 * from the illustration. tests/unit/isometric/iso-theme.test.ts checks WCAG
 * contrast: text ≥ 4.5:1 on its halo/fill; markers, selection and the route
 * ≥ 3:1 against every surface they are drawn over.
 */
import type { FaceTone } from './faces.ts';

export type IsoTheme = 'light' | 'dark';

export interface IsoBuildingTones {
  roof: string;
  roofShade: string;
  wallLit: string;
  wallMid: string;
  wallShade: string;
  edge: string;
}

export interface IsoThemeColors {
  /** Everything outside the campus boundary. */
  surroundings: string;
  campusGround: string;
  campusOutline: string;
  landuse: string;
  green: string;
  pitch: string;
  parking: string;
  water: string;
  /** Pedestrian areas (no such polygons in today's basemap; kept for the role). */
  pedestrian: string;
  roadBand: string;
  roadCasing: string;
  roadDash: string;
  service: string;
  path: string;
  steps: string;
  /** Map-key reference grid (200 m cells). */
  grid: string;
  gridText: string;
  /** Prisms with an estimated or measured height. */
  building: IsoBuildingTones;
  /** Prisms whose height is a placeholder: lighter, with a dashed roof outline. */
  placeholder: IsoBuildingTones;
  /** Synthetic windows on owner-authored models (appearance only). */
  glass: string;
  selected: string;
  selectedHalo: string;
  selectedRoof: string;
  route: string;
  routeCasing: string;
  routeAlt: string;
  routeCompleted: string;
  endpointFill: string;
  endpointText: string;
  keyMarkerFill: string;
  keyMarkerStroke: string;
  keyMarkerText: string;
  labelText: string;
  labelHalo: string;
}

export const ISO_THEME_COLORS: Readonly<Record<IsoTheme, IsoThemeColors>> = {
  light: {
    surroundings: '#ebe3d3',
    campusGround: '#f6f1e6',
    campusOutline: '#9a3412',
    landuse: '#ece5d6',
    green: '#a8d08d',
    pitch: '#93c47d',
    parking: '#cfccc6',
    water: '#9ecae8',
    pedestrian: '#ecd3cd',
    roadBand: '#3f3d3a',
    roadCasing: '#26241f',
    roadDash: '#f4efe4',
    service: '#6b6863',
    path: '#b9776a',
    steps: '#7d4f42',
    grid: '#b8ad99',
    gridText: '#5f5648',
    building: {
      roof: '#f2e3d5',
      roofShade: '#dcc8b6',
      wallLit: '#cf7152',
      wallMid: '#b55a3e',
      wallShade: '#8e4330',
      edge: '#5a2a1c',
    },
    placeholder: {
      roof: '#eeeae5',
      roofShade: '#ddd8d2',
      wallLit: '#d9c9bf',
      wallMid: '#c7b5aa',
      wallShade: '#ad9a8f',
      edge: '#7c6d64',
    },
    glass: '#a9c1d3',
    selected: '#1e3a8a',
    selectedHalo: '#ffffff',
    selectedRoof: '#dbe7ff',
    route: '#1d4ed8',
    routeCasing: '#ffffff',
    routeAlt: '#64748b',
    routeCompleted: '#94a3b8',
    endpointFill: '#1d4ed8',
    endpointText: '#ffffff',
    keyMarkerFill: '#ffffff',
    keyMarkerStroke: '#17181a',
    keyMarkerText: '#17181a',
    labelText: '#17181a',
    labelHalo: '#ffffff',
  },
  dark: {
    surroundings: '#0e1217',
    campusGround: '#161c23',
    campusOutline: '#fb923c',
    landuse: '#1a2028',
    green: '#1d3524',
    pitch: '#22422a',
    parking: '#262b33',
    water: '#143049',
    pedestrian: '#2e2226',
    roadBand: '#3a414b',
    roadCasing: '#05070a',
    roadDash: '#aab3bf',
    service: '#2f353e',
    path: '#b88b7d',
    steps: '#d5b8aa',
    grid: '#3a434e',
    gridText: '#aab3bf',
    building: {
      roof: '#6b5a4f',
      roofShade: '#5a4b41',
      wallLit: '#9c5640',
      wallMid: '#7e4532',
      wallShade: '#5e3224',
      edge: '#140a06',
    },
    placeholder: {
      roof: '#4a4e55',
      roofShade: '#43474d',
      wallLit: '#5b5f66',
      wallMid: '#4d5157',
      wallShade: '#3e4248',
      edge: '#16181b',
    },
    glass: '#4f6b80',
    selected: '#93c5fd',
    selectedHalo: '#0b0f14',
    selectedRoof: '#2a3b5c',
    route: '#60a5fa',
    routeCasing: '#0b0f14',
    routeAlt: '#94a3b8',
    routeCompleted: '#475569',
    endpointFill: '#60a5fa',
    endpointText: '#0b0f14',
    keyMarkerFill: '#0b0f14',
    keyMarkerStroke: '#eef0f3',
    keyMarkerText: '#eef0f3',
    labelText: '#eef0f3',
    labelHalo: '#0b0f14',
  },
};

export const toneColour = (tones: IsoBuildingTones, tone: FaceTone): string => tones[tone];
