import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_CONFIG } from '../../../src/config/index.ts';
import { HOURS_LABELS, evaluateHours } from '../../../src/facilities/index.ts';

/** Instant for a campus-local (IST) wall-clock time; independent of the process time zone. */
const ist = (local: string) => new Date(`${local}:00+05:30`);

// 2026-10-19 is a Monday; 2026-10-25 is a Sunday.
const MON = '2026-10-19';
const TUE = '2026-10-20';
const FRI = '2026-10-23';
const SAT = '2026-10-24';
const SUN = '2026-10-25';
const NEXT_MON = '2026-10-26';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('evaluateHours — missing and unparseable', () => {
  it('reports unknown when hours are not published', () => {
    expect(evaluateHours(undefined, ist(`${MON}T10:00`))).toEqual({
      state: 'unknown',
      label: HOURS_LABELS.notPublished,
    });
    expect(evaluateHours('  ', ist(`${MON}T10:00`)).label).toBe(HOURS_LABELS.notPublished);
  });

  it('reports unknown (not closed) for unsupported syntax', () => {
    for (const raw of ['Mo-Fr 09:00-17:00; PH off', 'sunrise-sunset', 'unknown', 'Mo 25:00-26:00']) {
      const r = evaluateHours(raw, ist(`${MON}T10:00`));
      expect(r.state, raw).toBe('unknown');
      expect(r.label).toBe('Hours listed but not in a format we can interpret');
      expect(r.nextChange).toBeUndefined();
    }
  });

  it('does not evaluate against an invalid current time', () => {
    expect(evaluateHours('24/7', new Date(Number.NaN)).state).toBe('unknown');
  });
});

describe('evaluateHours — open/closed per published hours', () => {
  it('24/7 is open with no next change', () => {
    const r = evaluateHours('24/7', ist(`${SUN}T03:00`));
    expect(r.state).toBe('open');
    expect(r.label).toBe('Open 24/7 per published hours');
    expect(r.nextChange).toBeUndefined();
  });

  it('every-day 00:00-24:00 is treated as continuously open', () => {
    expect(evaluateHours('00:00-24:00', ist(`${SUN}T23:59`)).nextChange).toBeUndefined();
  });

  it('is open inside a range and reports the closing time', () => {
    const r = evaluateHours('Mo-Fr 09:00-22:00', ist(`${MON}T10:15`));
    expect(r.state).toBe('open');
    expect(r.label).toBe('Open per published hours · closes 22:00');
    expect(r.nextChange?.toISOString()).toBe(ist(`${MON}T22:00`).toISOString());
  });

  it('never phrases the result as a live fact', () => {
    for (const at of [`${MON}T10:00`, `${SAT}T10:00`]) {
      const label = evaluateHours('Mo-Fr 09:00-22:00', ist(at)).label;
      expect(label).toContain('per published hours');
      expect(label).not.toMatch(/open now/i);
    }
  });

  it('treats start as inclusive and end as exclusive', () => {
    expect(evaluateHours('Mo 09:00-17:00', ist(`${MON}T09:00`)).state).toBe('open');
    expect(evaluateHours('Mo 09:00-17:00', ist(`${MON}T17:00`)).state).toBe('closed');
  });

  it('reports the next opening later the same day without a weekday', () => {
    const r = evaluateHours('Mo 09:00-12:00,14:00-18:00', ist(`${MON}T12:30`));
    expect(r.state).toBe('closed');
    expect(r.label).toBe('Closed per published hours · opens 14:00');
    expect(r.nextChange?.toISOString()).toBe(ist(`${MON}T14:00`).toISOString());
  });

  it('reports the next opening on a later day with the weekday', () => {
    const r = evaluateHours('Mo-Fr 09:00-17:00', ist(`${SAT}T11:00`));
    expect(r.state).toBe('closed');
    expect(r.label).toBe('Closed per published hours · opens Mon 09:00');
    expect(r.nextChange?.toISOString()).toBe(ist(`${NEXT_MON}T09:00`).toISOString());
  });

  it('handles wrap-around weekday ranges', () => {
    const raw = 'Fr-Mo 10:00-16:00';
    expect(evaluateHours(raw, ist(`${SUN}T12:00`)).state).toBe('open');
    expect(evaluateHours(raw, ist(`${MON}T12:00`)).state).toBe('open');
    const tue = evaluateHours(raw, ist(`${TUE}T12:00`));
    expect(tue.state).toBe('closed');
    expect(tue.label).toBe('Closed per published hours · opens Fri 10:00');
  });

  it('spills an overnight range into the next morning', () => {
    const raw = 'Fr 18:00-02:00';
    const late = evaluateHours(raw, ist(`${FRI}T23:00`));
    expect(late.label).toBe('Open per published hours · closes Sat 02:00');
    expect(evaluateHours(raw, ist(`${SAT}T01:59`)).state).toBe('open');
    expect(evaluateHours(raw, ist(`${SAT}T02:00`)).state).toBe('closed');
    expect(evaluateHours(raw, ist(`${FRI}T01:00`)).state).toBe('closed');
  });

  it('spills Sunday overnight hours into Monday across the week boundary', () => {
    const raw = 'Su 20:00-03:00';
    const mon = evaluateHours(raw, ist(`${MON}T02:30`));
    expect(mon.state).toBe('open');
    expect(mon.label).toBe('Open per published hours · closes 03:00');
    expect(mon.nextChange?.toISOString()).toBe(ist(`${MON}T03:00`).toISOString());
    expect(evaluateHours(raw, ist(`${SUN}T21:00`)).nextChange?.toISOString()).toBe(
      ist(`${NEXT_MON}T03:00`).toISOString(),
    );
  });

  it('merges a same-day range that continues into an overnight range', () => {
    const r = evaluateHours('Mo 08:00-24:00; Tu 00:00-02:00', ist(`${MON}T23:00`));
    expect(r.label).toBe('Open per published hours · closes Tue 02:00');
  });

  it('merges Sunday-to-midnight with Monday early hours across the week boundary', () => {
    const r = evaluateHours('Su 22:00-24:00; Mo 00:00-02:00', ist(`${SUN}T23:00`));
    expect(r.label).toBe('Open per published hours · closes Mon 02:00');
    expect(r.nextChange?.toISOString()).toBe(ist(`${NEXT_MON}T02:00`).toISOString());
  });

  it('names the weekday when the next opening is the same weekday next week', () => {
    const r = evaluateHours('Mo 09:00-10:00', ist(`${MON}T11:00`));
    expect(r.label).toBe('Closed per published hours · opens Mon 09:00');
    expect(r.nextChange?.toISOString()).toBe(ist(`${NEXT_MON}T09:00`).toISOString());
  });

  it('labels a closing time of midnight as 24:00', () => {
    expect(evaluateHours('Mo 18:00-24:00', ist(`${MON}T19:00`)).label).toBe(
      'Open per published hours · closes 24:00',
    );
  });

  it('applies override semantics including off', () => {
    const raw = 'Mo-Su 09:00-21:00; Sa 10:00-14:00; Su off';
    expect(evaluateHours(raw, ist(`${SAT}T09:30`)).state).toBe('closed');
    expect(evaluateHours(raw, ist(`${SAT}T15:00`)).label).toBe(
      'Closed per published hours · opens Mon 09:00',
    );
    expect(evaluateHours(raw, ist(`${SUN}T12:00`)).state).toBe('closed');
    expect(evaluateHours(raw, ist(`${TUE}T20:59`)).state).toBe('open');
  });

  it('keeps overnight spill when the next day is set off (spill belongs to its own day)', () => {
    expect(evaluateHours('Fr 20:00-02:00; Sa off', ist(`${SAT}T01:00`)).state).toBe('open');
  });

  it('reports closed with no next change when every day is off', () => {
    const r = evaluateHours('off', ist(`${MON}T12:00`));
    expect(r.state).toBe('closed');
    expect(r.nextChange).toBeUndefined();
  });
});

describe('evaluateHours — campus time zone', () => {
  it('evaluates in IST even when the process runs in America/New_York', () => {
    vi.stubEnv('TZ', 'America/New_York');
    // 04:00Z is Monday 09:30 in IST and Monday 00:00 in New York (EDT, UTC-4).
    const now = new Date('2026-10-19T04:00:00Z');
    expect(now.getHours()).toBe(0); // proves the device clock really is in New York here
    const r = evaluateHours('Mo 09:00-10:00', now);
    expect(r.state).toBe('open');
    expect(r.label).toBe('Open per published hours · closes 10:00');
    expect(r.nextChange?.toISOString()).toBe('2026-10-19T04:30:00.000Z');
  });

  it('uses the IST weekday, not the device weekday, around midnight', () => {
    vi.stubEnv('TZ', 'America/New_York');
    // 2026-10-19T19:00Z is Monday 15:00 in New York but Tuesday 00:30 in IST.
    const now = new Date('2026-10-19T19:00:00Z');
    expect(now.getDay()).toBe(1);
    expect(evaluateHours('Tu 00:00-01:00', now).state).toBe('open');
    expect(evaluateHours('Mo 00:00-24:00', now).state).toBe('closed');
  });
});

describe('evaluateHours — staleness', () => {
  const now = ist(`${MON}T10:00`);

  it('is not stale within the freshness window', () => {
    expect(evaluateHours('Mo 09:00-17:00', now, { retrievedAt: '2026-10-01T00:00:00Z' }).state).toBe('open');
  });

  it('is stale beyond the default freshness window but keeps the computed openness', () => {
    const days = APP_CONFIG.cache.hoursFreshnessDays;
    const old = new Date(now.getTime() - (days + 1) * 86_400_000).toISOString();
    const r = evaluateHours('Mo 09:00-17:00', now, { retrievedAt: old });
    expect(r.state).toBe('stale');
    expect(r.label).toMatch(/may be outdated/);
    expect(r.label).toContain(`${days} days`);
    expect(r.reason).toContain('Open per published hours · closes 17:00');
    expect(r.nextChange?.toISOString()).toBe(ist(`${MON}T17:00`).toISOString());
  });

  it('honours a custom freshness window', () => {
    const r = evaluateHours('Mo 09:00-17:00', now, { retrievedAt: '2026-10-01T00:00:00Z', freshnessDays: 7 });
    expect(r.state).toBe('stale');
    expect(r.label).toContain('2026-10-01');
  });

  it('falls back to the default window when freshnessDays is not a usable number', () => {
    const days = APP_CONFIG.cache.hoursFreshnessDays;
    const ancient = '2000-01-01T00:00:00Z';
    for (const freshnessDays of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      const r = evaluateHours('Mo 09:00-17:00', now, { retrievedAt: ancient, freshnessDays });
      expect(r.state, String(freshnessDays)).toBe('stale');
      expect(r.label).toContain(`over ${days} days`);
    }
    const recent = evaluateHours('Mo 09:00-17:00', now, {
      retrievedAt: `${MON}T00:00:00Z`,
      freshnessDays: -5,
    });
    expect(recent.state).toBe('open');
  });

  it('treats an unreadable retrieval date as stale rather than fresh', () => {
    const r = evaluateHours('Mo 09:00-17:00', now, { retrievedAt: 'last spring' });
    expect(r.state).toBe('stale');
    expect(r.reason).toContain('Open per published hours');
  });

  it('keeps unknown hours unknown regardless of retrieval age', () => {
    expect(evaluateHours('PH off', now, { retrievedAt: '2000-01-01' }).state).toBe('unknown');
    expect(evaluateHours(undefined, now, { retrievedAt: '2000-01-01' }).state).toBe('unknown');
  });
});
