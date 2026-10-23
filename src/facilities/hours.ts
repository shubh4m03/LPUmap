/**
 * Evaluates parsed opening hours against a moment in campus local time.
 *
 * LPU is in India (Asia/Kolkata, UTC+05:30, no daylight saving), so evaluation
 * uses a fixed offset applied to the UTC instant. The device time zone is
 * never consulted: a visitor with a phone set to New York still sees whether
 * the facility is open per its published hours in Phagwara.
 *
 * Results describe published hours only — never a live status.
 */
import { APP_CONFIG } from '../config/index.ts';
import { MINUTES_PER_DAY, parseOpeningHours } from './hours-parse.ts';
import type { ParsedHours, TimeRange } from './hours-parse.ts';

export { parseOpeningHours, parseWeekdaySelector, WEEKDAY_CODES } from './hours-parse.ts';
export type { ParsedHours, TimeRange } from './hours-parse.ts';

export type HoursState = 'open' | 'closed' | 'unknown' | 'stale';

export interface HoursEvaluation {
  state: HoursState;
  label: string;
  nextChange?: Date;
  reason?: string;
}

/** Asia/Kolkata offset from UTC in minutes. India has not observed DST since 1945. */
export const CAMPUS_UTC_OFFSET_MIN = 330;

export const HOURS_LABELS = {
  notPublished: 'Hours not published',
  unparseable: 'Hours listed but not in a format we can interpret',
  invalidNow: 'Current time unavailable, so published hours were not evaluated',
} as const;

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MS_PER_MIN = 60_000;
const MS_PER_DAY = MINUTES_PER_DAY * MS_PER_MIN;
const WEEK_MIN = 7 * MINUTES_PER_DAY;
/** 1970-01-01 was a Thursday, i.e. index 3 when Monday is 0. */
const EPOCH_WEEKDAY = 3;

const pad2 = (n: number) => String(n).padStart(2, '0');

function hhmm(minuteOfDay: number): string {
  return `${pad2(Math.floor(minuteOfDay / 60))}:${pad2(minuteOfDay % 60)}`;
}

const mod = (n: number, m: number) => ((n % m) + m) % m;

/** Position of `now` inside the campus-local week (Monday 00:00 = 0). */
function campusWeekPosition(now: Date): { msIntoWeek: number; weekday: number } {
  const localMs = now.getTime() + CAMPUS_UTC_OFFSET_MIN * MS_PER_MIN;
  const dayNumber = Math.floor(localMs / MS_PER_DAY);
  const weekday = mod(dayNumber + EPOCH_WEEKDAY, 7);
  return { msIntoWeek: localMs - (dayNumber - weekday) * MS_PER_DAY, weekday };
}

/**
 * Merged open intervals in minutes-of-week, replicated over the previous and
 * next week so Sunday→Monday spill and look-ahead need no special cases.
 */
function weekIntervals(parsed: ParsedHours): Array<[number, number]> {
  const raw: Array<[number, number]> = [];
  parsed.days.forEach((ranges, d) => {
    for (const r of ranges) {
      for (const offset of [-WEEK_MIN, 0, WEEK_MIN]) {
        raw.push([d * MINUTES_PER_DAY + r.start + offset, d * MINUTES_PER_DAY + r.end + offset]);
      }
    }
  });
  raw.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const iv of raw) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else merged.push([iv[0], iv[1]]);
  }
  return merged;
}

function describeChange(targetMin: number, todayStartMin: number, closing: boolean): string {
  const diff = targetMin - todayStartMin;
  if (diff > 0 && (diff < MINUTES_PER_DAY || (closing && diff === MINUTES_PER_DAY))) return hhmm(diff);
  const day = DAY_NAMES[mod(Math.floor(targetMin / MINUTES_PER_DAY), 7)] ?? '';
  return `${day} ${hhmm(mod(targetMin, MINUTES_PER_DAY))}`;
}

/** Open/closed per the published schedule (no staleness handling). */
export function evaluateParsedHours(parsed: ParsedHours, now: Date): HoursEvaluation {
  const reason = 'Based on the published opening_hours value, not a live status.';
  const intervals = weekIntervals(parsed);
  if (intervals.some(([s, e]) => s <= 0 && e >= WEEK_MIN)) {
    return { state: 'open', label: 'Open 24/7 per published hours', reason };
  }
  if (intervals.length === 0) {
    return { state: 'closed', label: 'Closed per published hours (no opening times listed)', reason };
  }
  const { msIntoWeek, weekday } = campusWeekPosition(now);
  const todayStart = weekday * MINUTES_PER_DAY;
  const at = (minuteOfWeek: number) => new Date(now.getTime() + minuteOfWeek * MS_PER_MIN - msIntoWeek);
  const current = intervals.find(([s, e]) => s * MS_PER_MIN <= msIntoWeek && msIntoWeek < e * MS_PER_MIN);
  if (current) {
    return {
      state: 'open',
      label: `Open per published hours · closes ${describeChange(current[1], todayStart, true)}`,
      nextChange: at(current[1]),
      reason,
    };
  }
  const next = intervals.find(([s]) => s * MS_PER_MIN > msIntoWeek);
  if (!next) return { state: 'closed', label: 'Closed per published hours', reason };
  return {
    state: 'closed',
    label: `Closed per published hours · opens ${describeChange(next[0], todayStart, false)}`,
    nextChange: at(next[0]),
    reason,
  };
}

/**
 * Full evaluation for UI: unknown when missing or unparseable (the UI shows
 * the raw value), stale when the source retrieval is older than the freshness window.
 */
export function evaluateHours(
  raw: string | undefined,
  now: Date,
  opts: { retrievedAt?: string; freshnessDays?: number } = {},
): HoursEvaluation {
  if (raw === undefined || raw.trim() === '') return { state: 'unknown', label: HOURS_LABELS.notPublished };
  const parsed = parseOpeningHours(raw);
  if (!parsed) {
    return {
      state: 'unknown',
      label: HOURS_LABELS.unparseable,
      reason: 'The value uses opening_hours syntax this app does not interpret; it is shown as written.',
    };
  }
  if (Number.isNaN(now.getTime())) return { state: 'unknown', label: HOURS_LABELS.invalidNow };
  const result = evaluateParsedHours(parsed, now);
  if (opts.retrievedAt === undefined) return result;

  // A non-finite or negative window would silently mark ancient hours fresh (NaN) or produce nonsense labels.
  const requested = opts.freshnessDays;
  const freshnessDays =
    requested !== undefined && Number.isFinite(requested) && requested >= 0
      ? requested
      : APP_CONFIG.cache.hoursFreshnessDays;
  const retrieved = Date.parse(opts.retrievedAt);
  if (Number.isNaN(retrieved)) {
    return {
      ...result,
      state: 'stale',
      label: 'Published hours may be outdated (retrieval date unknown)',
      reason: `Per published hours: ${result.label}`,
    };
  }
  if (now.getTime() - retrieved > freshnessDays * MS_PER_DAY) {
    const date = new Date(retrieved).toISOString().slice(0, 10);
    return {
      ...result,
      state: 'stale',
      label: `Published hours may be outdated (retrieved ${date}, over ${freshnessDays} days ago)`,
      reason: `If still accurate: ${result.label}`,
    };
  }
  return result;
}

function formatRange(r: TimeRange): string {
  const overnight = r.end > MINUTES_PER_DAY;
  const end = overnight ? r.end - MINUTES_PER_DAY : r.end;
  return `${hhmm(r.start)}–${hhmm(end)}${overnight ? ' (next day)' : ''}`;
}

function formatDay(ranges: readonly TimeRange[]): string {
  if (ranges.length === 0) return 'Closed';
  if (ranges.length === 1 && ranges[0]?.start === 0 && ranges[0].end === MINUTES_PER_DAY)
    return 'Open 24 hours';
  return ranges.map(formatRange).join(', ');
}

/** Weekly schedule lines for the details panel, grouping consecutive identical days. */
export function formatScheduleLines(parsed: ParsedHours): string[] {
  const texts = parsed.days.map(formatDay);
  if (texts.every((t) => t === texts[0])) return [`Every day: ${texts[0] ?? 'Closed'}`];
  const lines: string[] = [];
  let start = 0;
  for (let d = 1; d <= texts.length; d++) {
    if (d < texts.length && texts[d] === texts[start]) continue;
    const span = d - 1 === start ? DAY_NAMES[start] : `${DAY_NAMES[start]}–${DAY_NAMES[d - 1]}`;
    lines.push(`${span}: ${texts[start]}`);
    start = d;
  }
  return lines;
}
