import { describe, expect, it } from 'vitest';
import {
  formatScheduleLines,
  parseOpeningHours,
  parseWeekdaySelector,
} from '../../../src/facilities/index.ts';

const h = (hh: number, mm = 0) => hh * 60 + mm;

describe('parseWeekdaySelector', () => {
  it('parses single days, ranges, lists and combinations', () => {
    expect(parseWeekdaySelector('We')).toEqual([2]);
    expect(parseWeekdaySelector('Mo-Fr')).toEqual([0, 1, 2, 3, 4]);
    expect(parseWeekdaySelector('Mo,We,Fr')).toEqual([0, 2, 4]);
    expect(parseWeekdaySelector('Mo-Fr,Su')).toEqual([0, 1, 2, 3, 4, 6]);
  });

  it('supports wrap-around ranges', () => {
    expect(parseWeekdaySelector('Fr-Mo')).toEqual([0, 4, 5, 6]);
    expect(parseWeekdaySelector('Su-Tu')).toEqual([0, 1, 6]);
  });

  it('rejects unknown or unsupported selectors', () => {
    for (const s of ['PH', 'Mo-PH', 'mo-fr', 'Mo[1]', 'Mon', 'Mo-', 'Xx', 'Su,PH', '']) {
      expect(parseWeekdaySelector(s), s).toBeNull();
    }
  });
});

describe('parseOpeningHours', () => {
  it('parses 24/7 as every day, all day', () => {
    const p = parseOpeningHours('24/7');
    expect(p?.always).toBe(true);
    expect(p?.days).toHaveLength(7);
    for (const d of p?.days ?? []) expect(d).toEqual([{ start: 0, end: 1440 }]);
  });

  it('applies a rule without weekdays to every day', () => {
    const p = parseOpeningHours('08:00-20:00');
    for (const d of p?.days ?? []) expect(d).toEqual([{ start: h(8), end: h(20) }]);
    expect(p?.always).toBe(false);
  });

  it('parses multiple ranges, sorted, with or without spaces after commas', () => {
    const a = parseOpeningHours('Mo-Fr 13:00-17:00,09:00-12:30');
    const b = parseOpeningHours('Mo-Fr 13:00-17:00, 09:00-12:30');
    expect(a?.days[0]).toEqual([
      { start: h(9), end: h(12, 30) },
      { start: h(13), end: h(17) },
    ]);
    expect(b).toEqual(a);
    expect(a?.days[5]).toEqual([]);
  });

  it('accepts 24:00 as an end and treats 00:00 as an end of midnight', () => {
    expect(parseOpeningHours('Mo 18:00-24:00')?.days[0]).toEqual([{ start: h(18), end: 1440 }]);
    expect(parseOpeningHours('Mo 18:00-00:00')?.days[0]).toEqual([{ start: h(18), end: 1440 }]);
  });

  it('represents an overnight range as extending past 24:00 on its own day', () => {
    expect(parseOpeningHours('Fr 18:00-02:00')?.days[4]).toEqual([{ start: h(18), end: 1440 + h(2) }]);
  });

  it('lets later rules override earlier rules for the days they name', () => {
    const p = parseOpeningHours('Mo-Su 09:00-21:00; Sa 10:00-14:00; Su off');
    expect(p?.days[0]).toEqual([{ start: h(9), end: h(21) }]);
    expect(p?.days[5]).toEqual([{ start: h(10), end: h(14) }]);
    expect(p?.days[6]).toEqual([]);
  });

  it('treats off and closed identically', () => {
    expect(parseOpeningHours('Mo-Fr 09:00-17:00; Sa,Su closed')).toEqual(
      parseOpeningHours('Mo-Fr 09:00-17:00; Sa,Su off'),
    );
  });

  it('days not named by any rule are closed', () => {
    const p = parseOpeningHours('Tu 10:00-11:00');
    expect(p?.days.filter((d) => d.length > 0)).toHaveLength(1);
  });

  it('tolerates surrounding whitespace and one trailing semicolon', () => {
    expect(parseOpeningHours('  Mo 09:00-10:00;  ')?.days[0]).toEqual([{ start: h(9), end: h(10) }]);
  });

  it.each([
    'PH off',
    'Mo-Fr 09:00-17:00; PH off',
    'SH off',
    'Jan-Mar Mo 09:00-12:00',
    'week 1-10 Mo 09:00-12:00',
    '2026 Mo 09:00-12:00',
    'Mo-Fr sunrise-sunset',
    'Mo-Fr 09:00-(sunset-01:00)',
    'Mo-Fr 09:00+',
    'Mo-Fr 09:00-17:00 "by appointment"',
    "Mo 09:00-12:00 'note'",
    'Mo-Fr 09:00-17:00 || "call ahead"',
    'unknown',
    'Mo-Fr',
    'Mo-Fr 09:00-17:00, Sa 10:00-14:00',
    'Mo-Fr 9:00-17:00',
    'Mo-Fr 0900-1700',
    'mo-fr 09:00-17:00',
    'Mo-Fr 09:00-17:00 off',
    'Mo;;Tu 09:00-10:00',
    ';',
    '',
    '   ',
  ])('rejects unsupported syntax: %j', (raw) => {
    expect(parseOpeningHours(raw)).toBeNull();
  });

  it.each([
    'Mo 25:00-26:00',
    'Mo 10:00-10:00',
    'Mo 09:60-10:00',
    'Mo 24:00-02:00',
    'Mo 09:00-24:30',
    'Mo 18:00-26:00',
  ])('rejects invalid or zero-length times: %j', (raw) => {
    expect(parseOpeningHours(raw)).toBeNull();
  });
});

describe('formatScheduleLines', () => {
  const lines = (raw: string) => {
    const p = parseOpeningHours(raw);
    if (!p) throw new Error(`fixture did not parse: ${raw}`);
    return formatScheduleLines(p);
  };

  it('collapses identical weeks into one line', () => {
    expect(lines('24/7')).toEqual(['Every day: Open 24 hours']);
    expect(lines('08:00-20:00')).toEqual(['Every day: 08:00–20:00']);
  });

  it('groups consecutive identical days and marks closed days', () => {
    expect(lines('Mo-Fr 09:00-12:00,13:00-17:00; Sa 10:00-14:00')).toEqual([
      'Mon–Fri: 09:00–12:00, 13:00–17:00',
      'Sat: 10:00–14:00',
      'Sun: Closed',
    ]);
  });

  it('labels overnight ranges and does not merge non-adjacent days', () => {
    expect(lines('Mo,We 09:00-10:00; Fr 18:00-02:00')).toEqual([
      'Mon: 09:00–10:00',
      'Tue: Closed',
      'Wed: 09:00–10:00',
      'Thu: Closed',
      'Fri: 18:00–02:00 (next day)',
      'Sat–Sun: Closed',
    ]);
  });

  it('formats an always-closed schedule', () => {
    expect(lines('off')).toEqual(['Every day: Closed']);
  });
});
