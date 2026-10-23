import type { PlaceKind } from './schema.ts';

/** User-facing name of each place kind (shared by place details and search subtitles). */
export const PLACE_KIND_LABELS: Record<PlaceKind, string> = {
  building: 'Building',
  facility: 'Facility',
  gate: 'Campus gate',
  entrance: 'Building entrance',
  landmark: 'Landmark',
  area: 'Area',
  organization: 'Department or office',
};
