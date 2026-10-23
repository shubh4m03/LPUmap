/**
 * Conservative parser for a documented SUBSET of the OSM `opening_hours`
 * syntax. Anything outside the subset makes the whole value unparseable
 * (`null`), so the UI shows "unknown" rather than guessing.
 *
 * Supported:
 *   - `24/7` (as the whole value or as one rule in a sequence)
 *   - rules separated by `;`, each `[weekdays] (time ranges | off | closed)`
 *   - weekdays `Mo`..`Su`, ranges `Mo-Fr`, wrap-around `Fr-Mo`, lists `Mo,We,Fr`, mixes `Mo-Fr,Su`
 *   - times `HH:MM-HH:MM` (`24:00` allowed only as an end), comma-separated;
 *     an end earlier than the start spills past midnight into the next day
 *   - a rule without weekdays applies every day; later rules replace earlier
 *     rules for the days they name (OSM semantics)
 *
 * Overnight spill stays attached to the rule's own day: `Fr 18:00-02:00; Sa off`
 * is open until Saturday 02:00, because `Sa off` replaces Saturday's own ranges.
 */

export const WEEKDAY_CODES = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;
export const MINUTES_PER_DAY = 1440;

/** Minutes from the start of the day; `end` may exceed 1440 for overnight ranges. */
export interface TimeRange {
  start: number;
  end: number;
}

export interface ParsedHours {
  /** Index 0 = Monday … 6 = Sunday. An empty array means closed that day. */
  days: ReadonlyArray<readonly TimeRange[]>;
  /** True when the value is exactly `24/7`. */
  always: boolean;
}

const TIME_RE = /^(\d{2}):(\d{2})$/;
const WEEKDAY_ITEM_RE = /^([A-Z][a-z])(?:-([A-Z][a-z]))?$/;
const FULL_DAY: TimeRange = { start: 0, end: MINUTES_PER_DAY };

function dayIndex(code: string): number {
  return (WEEKDAY_CODES as readonly string[]).indexOf(code);
}

function parseTime(s: string, isEnd: boolean): number | null {
  const m = TIME_RE.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return null;
  if (h === 24) return isEnd && min === 0 ? MINUTES_PER_DAY : null;
  if (h > 23) return null;
  return h * 60 + min;
}

function parseRange(s: string): TimeRange | null {
  const parts = s.split('-');
  if (parts.length !== 2) return null;
  const start = parseTime(parts[0] ?? '', false);
  const end = parseTime(parts[1] ?? '', true);
  if (start === null || end === null || start === end) return null;
  // `22:00-00:00` closes at midnight, not 24 hours later.
  if (end === 0) return { start, end: MINUTES_PER_DAY };
  return end > start ? { start, end } : { start, end: end + MINUTES_PER_DAY };
}

function parseRanges(s: string): TimeRange[] | null {
  const ranges: TimeRange[] = [];
  for (const piece of s.split(',')) {
    const r = parseRange(piece.trim());
    if (!r) return null;
    ranges.push(r);
  }
  return ranges.sort((a, b) => a.start - b.start);
}

/** Returns the day indexes named by a selector such as `Mo-Fr,Su`, or null if unsupported. */
export function parseWeekdaySelector(s: string): number[] | null {
  const days = new Set<number>();
  for (const item of s.split(',')) {
    const m = WEEKDAY_ITEM_RE.exec(item);
    if (!m) return null;
    const from = dayIndex(m[1] ?? '');
    const to = m[2] === undefined ? from : dayIndex(m[2]);
    if (from < 0 || to < 0) return null;
    for (let d = from; ; d = (d + 1) % 7) {
      days.add(d);
      if (d === to) break;
    }
  }
  return [...days].sort((a, b) => a - b);
}

interface Rule {
  days: number[];
  ranges: TimeRange[];
}

function parseRule(rule: string): Rule | null {
  const all = [0, 1, 2, 3, 4, 5, 6];
  if (rule === '24/7') return { days: all, ranges: [FULL_DAY] };
  const firstSpace = rule.search(/\s/);
  const head = firstSpace < 0 ? rule : rule.slice(0, firstSpace);
  const rest = firstSpace < 0 ? '' : rule.slice(firstSpace).trim();
  let days = all;
  let body = rule;
  if (/^[A-Za-z]/.test(head) && head !== 'off' && head !== 'closed') {
    const selected = parseWeekdaySelector(head);
    // A weekday selector with nothing after it ("Mo-Fr") is outside the subset.
    if (!selected || rest === '') return null;
    days = selected;
    body = rest;
  }
  if (body === 'off' || body === 'closed') return { days, ranges: [] };
  // Allow "09:00-12:00, 13:00-17:00" but no other internal whitespace.
  const compact = body.replace(/\s*,\s*/g, ',');
  if (/\s/.test(compact)) return null;
  const ranges = parseRanges(compact);
  return ranges ? { days, ranges } : null;
}

/** Parses the supported subset; returns null for anything else (shown as unknown). */
export function parseOpeningHours(raw: string): ParsedHours | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value === '' || value.includes('||') || /["']/.test(value)) return null;
  const segments = value.split(';').map((s) => s.trim());
  // Tolerate one trailing ';' but not empty rules in the middle.
  if (segments.length > 1 && segments[segments.length - 1] === '') segments.pop();
  if (segments.some((s) => s === '')) return null;

  const days: TimeRange[][] = [[], [], [], [], [], [], []];
  for (const segment of segments) {
    const rule = parseRule(segment);
    if (!rule) return null;
    for (const d of rule.days) days[d] = rule.ranges.map((r) => ({ ...r }));
  }
  return { days, always: segments.length === 1 && segments[0] === '24/7' };
}
