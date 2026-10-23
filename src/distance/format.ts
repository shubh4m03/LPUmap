/**
 * Human-readable distance, duration and speed labels. Precision is reduced
 * deliberately: consumer GPS and walking-speed estimates do not justify
 * metre- or second-level figures. Invalid input renders as an em dash rather
 * than a made-up number.
 */

export const UNKNOWN_LABEL = '—';

const valid = (n: number) => typeof n === 'number' && Number.isFinite(n) && n >= 0;

function roundTo(n: number, step: number): number {
  return Math.round(n / step) * step;
}

/** "< 10 m", "45 m", "950 m", "1.2 km", "12 km". */
export function formatDistance(m: number): string {
  if (!valid(m)) return UNKNOWN_LABEL;
  if (m < 10) return '< 10 m';
  const metres = m < 100 ? roundTo(m, 5) : roundTo(m, 10);
  if (metres < 1000) return `${metres} m`;
  const km = m / 1000;
  if (km < 9.95) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

/** "under 1 min", "7 min", "1 h 5 min", "2 h". */
export function formatDuration(s: number): string {
  if (!valid(s)) return UNKNOWN_LABEL;
  if (s < 60) return 'under 1 min';
  const totalMin = Math.round(s / 60);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return min === 0 ? `${h} h` : `${h} h ${min} min`;
}

/** Speed in km/h with one decimal, e.g. "4.7 km/h". */
export function formatSpeed(mps: number | null): string {
  if (mps === null || !valid(mps)) return UNKNOWN_LABEL;
  return `${(mps * 3.6).toFixed(1)} km/h`;
}
