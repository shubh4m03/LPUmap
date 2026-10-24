/**
 * Original geometric icon set on a 24px grid, drawn for this project. Each icon is a
 * list of SVG path strings stroked with currentColor; `fill: true` paths are filled.
 * Circles are written as two arcs so every glyph is plain path data.
 */

export interface IconPath {
  d: string;
  fill?: boolean;
}

// Both half-arcs must use the same sweep flag: the first runs right→left through the
// bottom, the second left→right through the top. (Flipping the second flag would
// retrace the bottom half and leave a semicircle.)
export const circle = (cx: number, cy: number, r: number): string =>
  `M${cx + r} ${cy}a${r} ${r} 0 1 1-${2 * r} 0 ${r} ${r} 0 1 1 ${2 * r} 0Z`;

const p = (...ds: string[]): IconPath[] => ds.map((d) => ({ d }));

const CROSSHAIR = [circle(12, 12, 7), 'M12 2v3', 'M12 19v3', 'M2 12h3', 'M19 12h3'];
const ARROW_CIRCLE = ['M4 12a8 8 0 1 0 2.35-5.65L4 8.7', 'M4 4v4.7h4.7'];
const HEART = 'M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20Z';

export const ICON_PATHS = {
  // Category glyphs (CategoryDef.icon)
  school: p('M2 9.5 12 4.5l10 5-10 5-10-5Z', 'M6 11.5v4.5c0 1.6 2.7 3 6 3s6-1.4 6-3v-4.5', 'M22 9.5V15'),
  bed: p('M3 5v14', 'M3 15h18v4', 'M21 15v-2.5A3.5 3.5 0 0 0 17.5 9H11v6', circle(7, 11.5, 1.75)),
  home: p('M3.5 11.5 12 4l8.5 7.5', 'M6 9.5V20h12V9.5', 'M10 20v-5.5h4V20'),
  utensils: p('M5 3v5a2 2 0 0 0 4 0V3', 'M7 3v18', 'M18 21V3c-2.2 1.4-3.5 4-3.5 7.5V14H18'),
  book: p(
    'M5 18.5V5.5A2.5 2.5 0 0 1 7.5 3H19v13H7.5A2.5 2.5 0 0 0 5 18.5Z',
    'M5 18.5A2.5 2.5 0 0 0 7.5 21H19v-5',
  ),
  cross: p('M9 3.5h6v5.5h5.5v6H15v5.5H9V15H3.5V9H9V3.5Z'),
  banknote: p('M3 6.5h18v11H3z', circle(12, 12, 2.5), 'M6.5 12h.01', 'M17.5 12h.01'),
  printer: p('M7 9V3.5h10V9', 'M7 17H4v-7.5h16V17h-3', 'M7 13.5h10V21H7z'),
  droplet: p('M12 3s6.5 6.6 6.5 11.5a6.5 6.5 0 0 1-13 0C5.5 9.6 12 3 12 3Z'),
  restroom: p(
    circle(6.5, 4.5, 1.5),
    circle(17.5, 4.5, 1.5),
    'M4.5 8.5h4v6M4.5 8.5v6M6.5 8.5V21',
    'M17.5 8.5 14.5 15h6l-3-6.5Z',
    'M16.5 15v6',
    'M18.5 15v6',
    'M12 3v18',
  ),
  shirt: p('M8.5 3.5 3 6.5l2 4.5 3-1.2V21h8V9.8l3 1.2 2-4.5-5.5-3a3.5 3.5 0 0 1-7 0Z'),
  ball: p(
    circle(12, 12, 9),
    'M3 12h18',
    'M12 3v18',
    'M5.6 5.6a12.5 12.5 0 0 1 0 12.8',
    'M18.4 5.6a12.5 12.5 0 0 0 0 12.8',
  ),
  tree: p('M12 21v-5', 'M12 3 6.5 10.5h3l-4 5.5h13l-4-5.5h3L12 3Z'),
  bus: p(
    'M6 3.5h12A1.5 1.5 0 0 1 19.5 5v12h-15V5A1.5 1.5 0 0 1 6 3.5Z',
    'M4.5 11h15',
    'M7.5 17v3',
    'M16.5 17v3',
    'M8 14h.01',
    'M16 14h.01',
  ),
  parking: p(
    'M5.5 3h13A2.5 2.5 0 0 1 21 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5v-13A2.5 2.5 0 0 1 5.5 3Z',
    'M10 17V7h3.25a3 3 0 0 1 0 6H10',
  ),
  gate: p('M3 21V4', 'M21 21V4', 'M3 7.5h18', 'M3 12h18', 'M7.5 7.5v13.5', 'M12 7.5v13.5', 'M16.5 7.5v13.5'),
  bag: p('M5 8h14l-1 13H6L5 8Z', 'M9 8V6.5a3 3 0 0 1 6 0V8'),
  star: p('m12 3.5 2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5Z'),
  building: p('M5 21V3.5h10V21', 'M15 9h4v12', 'M3 21h18', 'M8 7.5h4', 'M8 11.5h4', 'M8 15.5h4'),
  pin: p('M12 21.5s-7-6.3-7-12a7 7 0 0 1 14 0c0 5.7-7 12-7 12Z', circle(12, 9.5, 2.5)),

  // UI glyphs
  search: p(circle(11, 11, 7), 'm20 20-4.05-4.05'),
  close: p('M6 6l12 12', 'M18 6 6 18'),
  layers: p('M12 3 3 8l9 5 9-5-9-5Z', 'm3 12 9 5 9-5', 'm3 16 9 5 9-5'),
  locate: [...p(...CROSSHAIR), { d: circle(12, 12, 2.5), fill: true }],
  'locate-off': p(...CROSSHAIR, 'M3 3l18 18'),
  route: p(circle(6, 19, 2), circle(18, 5, 2), 'M8 19h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16'),
  swap: p('M8 20V4', 'm4 8 4-4 4 4', 'M16 4v16', 'm12 16 4 4 4-4'),
  heart: p(HEART),
  'heart-filled': [{ d: HEART, fill: true }],
  cube: p('m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z', 'm4 7.5 8 4.5 8-4.5', 'M12 12v9'),
  // Isometric overview: a diamond ground plane with a block standing on it.
  overview: p('m12 9 9 4.5-9 4.5-9-4.5L12 9Z', 'M9.5 12.2V7.5l2.5-1.2 2.5 1.2v4.7', 'M12 6.3v4.9'),
  'map-2d': p('M9 4 3 6.5V20l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4Z', 'M9 4v13.5', 'M15 6.5V20'),
  compass: [...p(circle(12, 12, 9)), { d: 'm15.5 8.5-2 5-5 2 2-5 5-2Z', fill: true }],
  plus: p('M12 5v14', 'M5 12h14'),
  minus: p('M5 12h14'),
  sun: p(
    circle(12, 12, 4),
    'M12 2.5v2',
    'M12 19.5v2',
    'm5.3 5.3 1.4 1.4',
    'm17.3 17.3 1.4 1.4',
    'M2.5 12h2',
    'M19.5 12h2',
    'm5.3 18.7 1.4-1.4',
    'm17.3 6.7 1.4-1.4',
  ),
  moon: p('M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z'),
  monitor: p(
    'M5 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z',
    'M8 20h8',
    'M12 16v4',
  ),
  menu: p('M4 7h16', 'M4 12h16', 'M4 17h16'),
  'chevron-left': p('m15 18-6-6 6-6'),
  'chevron-right': p('m9 18 6-6-6-6'),
  'chevron-down': p('m6 9 6 6 6-6'),
  'chevron-up': p('m6 15 6-6 6 6'),
  info: p(circle(12, 12, 9), 'M12 11v5', 'M12 8h.01'),
  warning: p(
    'M10.3 4.6a2 2 0 0 1 3.4 0l7.5 13A2 2 0 0 1 19.5 20.5h-15a2 2 0 0 1-1.7-2.9l7.5-13Z',
    'M12 10v4',
    'M12 17h.01',
  ),
  external: p('M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'),
  share: p(
    circle(18, 5, 2.5),
    circle(6, 12, 2.5),
    circle(18, 19, 2.5),
    'm8.2 10.8 7.6-4.6',
    'm8.2 13.2 7.6 4.6',
  ),
  walk: p(
    circle(13, 4.5, 1.75),
    'M9.5 21 12 14.5l3 3V21',
    'M12 14.5 12.75 8.5 9 10.5l-1 3.5',
    'M12.75 8.5 15 11.5l2.5 1',
  ),
  bike: p(
    circle(6, 16, 3.5),
    circle(18, 16, 3.5),
    'M6 16l3.5-7h5.5L18 16',
    'M9.5 9 12 16H6',
    'M13.5 6H16l-1 3',
  ),
  wheelchair: p(circle(11, 4.5, 1.5), 'M11 7.5V13h5l2 5h2', 'M11 10h4', 'M8 10.6a5 5 0 1 0 7.4 6.4'),
  steps: p('M3 20h5v-5h5v-5h5V5h3'),
  clock: p(circle(12, 12, 9), 'M12 7v5l3 2'),
  phone: p('M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1Z'),
  mail: p(
    'M4 5.5h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Z',
    'm3.5 7 8.5 6 8.5-6',
  ),
  globe: p(circle(12, 12, 9), 'M3 12h18', 'M12 3a14 14 0 0 1 0 18', 'M12 3a14 14 0 0 0 0 18'),
  flag: p('M5 21V4', 'M5 4h12l-2.5 4.5L17 13H5'),
  trash: p('M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'),
  settings: p(
    'M4 6h10',
    'M18 6h2',
    'M4 12h4',
    'M12 12h8',
    'M4 18h12',
    circle(16, 6, 2),
    circle(10, 12, 2),
    circle(18, 18, 2),
  ),
  reset: p(...ARROW_CIRCLE),
  navigation: p('M12 3 19 20l-7-4-7 4 7-17Z'),
  stop: p(
    'M8 6.5h8A1.5 1.5 0 0 1 17.5 8v8a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 16V8A1.5 1.5 0 0 1 8 6.5Z',
  ),
  check: p('m5 12.5 4.5 4.5L19 7'),
  'wifi-off': p(
    'M3 3l18 18',
    'M8.5 16.5a5 5 0 0 1 7 0',
    'M5 12.6a10 10 0 0 1 4-2.4',
    'M15.4 10.3a10 10 0 0 1 3.6 2.3',
    'M2 9a14 14 0 0 1 3.8-2.6',
    'M11 5.05A14 14 0 0 1 22 9',
    'M12 20h.01',
  ),
  download: p('M12 4v11', 'm7 10 5 5 5-5', 'M5 20h14'),
  keyboard: p(
    'M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z',
    'M7 10h.01',
    'M11 10h.01',
    'M15 10h.01',
    'M17 10h.01',
    'M8 14h8',
  ),
  history: p(...ARROW_CIRCLE, 'M12 8v4l3 2'),
} satisfies Record<string, IconPath[]>;

export type IconName = keyof typeof ICON_PATHS;

export const ICON_NAMES = Object.keys(ICON_PATHS) as IconName[];

export function isIconName(name: string): name is IconName {
  return Object.hasOwn(ICON_PATHS, name);
}

/** Maps a CategoryDef.icon string to a glyph; unknown names fall back to the generic pin. */
export function iconForCategory(icon: string): IconName {
  return isIconName(icon) ? icon : 'pin';
}
