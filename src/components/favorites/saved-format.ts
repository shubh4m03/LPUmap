import { getCategory } from '../../config/categories.ts';
import type { Place } from '../../data/index.ts';

/** Truthful one-line context: category, plus position/zone caveats when they apply. */
export function placeSubtitle(place: Place): string {
  const parts = [getCategory(place.categoryId).label];
  if (place.location === null) parts.push('No verified map position');
  else if (place.campusZone === 'off-campus-nearby') parts.push('Off campus (nearby)');
  return parts.join(' · ');
}
