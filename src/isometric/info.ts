/** Wording shared by the overview's info panel, canvas label and announcements. */
import type { HeightSource } from '../data/index.ts';
import type { IsoRotation } from './projection.ts';
import type { IsoBuilding } from './scene.ts';

/** Honest height wording, matching the 2D/3D legend semantics. */
export const HEIGHT_NOTES: Readonly<Record<HeightSource, string>> = {
  'osm-height': 'Height from a mapped height tag',
  'osm-levels-estimate': 'Height estimated from the floor count',
  fallback: 'Placeholder height: no height data',
  'studio-model': 'Illustrative height from an owner-placed model, not a measurement',
};

/** Title rule shared with the directory: name ?? `Building <key>` ?? the honest pipeline label. */
export const isoBuildingTitle = (b: Pick<IsoBuilding, 'name' | 'key' | 'displayName'>): string =>
  b.name ?? (b.key ? `Building ${b.key}` : b.displayName);

const TOP: Readonly<Record<IsoRotation, { short: string; long: string }>> = {
  0: { short: 'NE', long: 'north-east' },
  1: { short: 'SE', long: 'south-east' },
  2: { short: 'SW', long: 'south-west' },
  3: { short: 'NW', long: 'north-west' },
};

/** The compass direction at the top of the screen (θ = 45° + 90°·r). */
export const topDirection = (r: IsoRotation): { short: string; long: string } => TOP[r];
