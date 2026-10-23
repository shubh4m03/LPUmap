/**
 * Map palette for the light and dark themes.
 *
 * MapLibre paints with concrete colour values (it cannot read CSS custom
 * properties), so the map's restrained palette lives here. It must be kept in
 * step by hand with the design-system tokens (src/styles/tokens.css). Every colour is a hex value so
 * tests can check WCAG contrast; transparency is applied with separate
 * opacity paint properties in the layer builders.
 */

export type MapTheme = 'light' | 'dark';

export interface MapThemeColors {
  background: string;
  landuse: string;
  green: string;
  water: string;
  pitch: string;
  parking: string;
  campusFill: string;
  campusOutline: string;
  roadMajor: string;
  roadMajorCasing: string;
  road: string;
  roadCasing: string;
  service: string;
  path: string;
  steps: string;
  buildingFill: string;
  buildingOutline: string;
  /** Extrusion colours by BuildingProps.heightSource. */
  extrusionMeasured: string;
  extrusionEstimated: string;
  /** Neutral, lighter tone: the height is a placeholder, not data. */
  extrusionUnknown: string;
  selected: string;
  selectedOutline: string;
  labelText: string;
  labelHalo: string;
  roadLabelText: string;
  /**
   * Ring around POI markers. Category fill colours come from config and do not
   * all reach 3:1 on every map surface, so the ring itself must.
   */
  poiStroke: string;
  routeLine: string;
  routeCasing: string;
  routeCompleted: string;
  routeAlternative: string;
  userDot: string;
  userHalo: string;
  userAccuracy: string;
  userStale: string;
}

export const MAP_THEME_COLORS: Readonly<Record<MapTheme, MapThemeColors>> = {
  light: {
    background: '#f4f1ea',
    landuse: '#ece7dc',
    green: '#d5e6c9',
    water: '#b9d6ea',
    pitch: '#c9e0bb',
    parking: '#e6e3dd',
    campusFill: '#efe9dd',
    campusOutline: '#c2410c',
    roadMajor: '#fff8e8',
    roadMajorCasing: '#d3bd94',
    road: '#ffffff',
    roadCasing: '#d2cabd',
    service: '#fbfaf7',
    path: '#7d7264',
    steps: '#5e5246',
    buildingFill: '#ddd5c8',
    buildingOutline: '#bcb1a1',
    extrusionMeasured: '#c7b9a3',
    extrusionEstimated: '#d6cbba',
    extrusionUnknown: '#e7e6e3',
    selected: '#c2410c',
    selectedOutline: '#7c2d12',
    labelText: '#2b2620',
    labelHalo: '#f8f6f1',
    roadLabelText: '#4f463d',
    poiStroke: '#4a4239',
    routeLine: '#1d4ed8',
    routeCasing: '#ffffff',
    routeCompleted: '#94a3b8',
    routeAlternative: '#64748b',
    userDot: '#2563eb',
    userHalo: '#ffffff',
    userAccuracy: '#2563eb',
    userStale: '#8a8f98',
  },
  dark: {
    background: '#0f1419',
    landuse: '#151b22',
    green: '#15261b',
    water: '#0f2a3d',
    pitch: '#183020',
    parking: '#1b2027',
    campusFill: '#131920',
    campusOutline: '#f97316',
    roadMajor: '#3a4049',
    roadMajorCasing: '#07090c',
    road: '#2a313b',
    roadCasing: '#07090c',
    service: '#232931',
    path: '#9aa4b1',
    steps: '#c3cbd5',
    buildingFill: '#212831',
    buildingOutline: '#323c47',
    extrusionMeasured: '#3c4757',
    extrusionEstimated: '#333d4a',
    extrusionUnknown: '#4d5056',
    selected: '#f97316',
    selectedOutline: '#fed7aa',
    labelText: '#e6e9ee',
    labelHalo: '#0b0f14',
    roadLabelText: '#c3cad3',
    poiStroke: '#e6e9ee',
    routeLine: '#60a5fa',
    routeCasing: '#0b0f14',
    routeCompleted: '#64748b',
    routeAlternative: '#94a3b8',
    userDot: '#3b82f6',
    userHalo: '#e6e9ee',
    userAccuracy: '#3b82f6',
    userStale: '#7b818a',
  },
};

export function mapThemeColors(theme: MapTheme): MapThemeColors {
  return MAP_THEME_COLORS[theme];
}
