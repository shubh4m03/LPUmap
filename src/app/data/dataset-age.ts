/**
 * Dataset age (G-18). The campus data is a snapshot: manifest.builtFrom is when
 * its sources were retrieved. Past APP_CONFIG.cache.datasetStaleDays the app
 * says so plainly. It never claims the data IS wrong, only that it is old and
 * may no longer match the campus.
 */
import { APP_CONFIG } from '../../config/index.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DatasetAge {
  /** When the dataset's sources were retrieved. */
  retrievedAt: Date;
  /** Whole days since then (0 on the day itself; never negative). */
  days: number;
  stale: boolean;
}

/** Null when the retrieval date is missing or not a date (shown as "Not recorded" elsewhere). */
export function datasetAge(
  builtFrom: string | undefined,
  now: number = Date.now(),
  staleDays: number = APP_CONFIG.cache.datasetStaleDays,
): DatasetAge | null {
  if (!builtFrom) return null;
  const retrievedAt = new Date(builtFrom);
  const t = retrievedAt.getTime();
  if (Number.isNaN(t)) return null;
  const days = Math.max(0, Math.floor((now - t) / DAY_MS));
  return { retrievedAt, days, stale: days > staleDays };
}

function formatRetrieved(d: Date): string {
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

/** The warning text for a stale dataset (null when it is not stale). */
export function datasetAgeWarning(age: DatasetAge | null): string | null {
  if (!age?.stale) return null;
  return (
    `The campus data was retrieved on ${formatRetrieved(age.retrievedAt)}, ${age.days} days ago. ` +
    'Buildings, paths and places may have changed since. Check on site before relying on it.'
  );
}
