import { getCategory } from '../../config/index.ts';
import { APP_CONFIG } from '../../config/index.ts';
import type { Place } from '../../data/index.ts';

/** Truthful one-line context: category, plus position/zone caveats when they apply. */
export function placeSubtitle(place: Place): string {
  const parts = [getCategory(place.categoryId).label];
  if (place.location === null) parts.push('No verified map position');
  else if (place.campusZone === 'off-campus-nearby')
    parts.push(APP_CONFIG.optionalLayers.nearbyOutsideCampus.badge);
  return parts.join(' · ');
}
