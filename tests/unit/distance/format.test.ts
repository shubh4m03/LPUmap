import { describe, expect, it } from 'vitest';
import { formatDistance, formatDuration, formatSpeed } from '../../../src/distance/index.ts';

describe('formatDistance', () => {
  it.each([
    [0, '< 10 m'],
    [9.99, '< 10 m'],
    [10, '10 m'],
    [44, '45 m'],
    [45, '45 m'],
    [101, '100 m'],
    [954, '950 m'],
    [994, '990 m'],
    [996, '1.0 km'],
    [1200, '1.2 km'],
    [1249, '1.2 km'],
    [9949, '9.9 km'],
    [9960, '10 km'],
    [12_400, '12 km'],
  ])('%d m → %s', (m, label) => {
    expect(formatDistance(m)).toBe(label);
  });

  it('renders invalid input as unknown rather than a number', () => {
    expect(formatDistance(Number.NaN)).toBe('—');
    expect(formatDistance(-5)).toBe('—');
    expect(formatDistance(Infinity)).toBe('—');
  });
});

describe('formatDuration', () => {
  it.each([
    [0, 'under 1 min'],
    [59.9, 'under 1 min'],
    [60, '1 min'],
    [420, '7 min'],
    [449, '7 min'],
    [3569, '59 min'],
    [3570, '1 h'],
    [3900, '1 h 5 min'],
    [7200, '2 h'],
  ])('%d s → %s', (s, label) => {
    expect(formatDuration(s)).toBe(label);
  });

  it('renders invalid input as unknown', () => {
    expect(formatDuration(Number.NaN)).toBe('—');
    expect(formatDuration(-1)).toBe('—');
  });
});

describe('formatSpeed', () => {
  it('converts m/s to km/h with one decimal', () => {
    expect(formatSpeed(1.3)).toBe('4.7 km/h');
    expect(formatSpeed(0)).toBe('0.0 km/h');
    expect(formatSpeed(null)).toBe('—');
    expect(formatSpeed(Number.NaN)).toBe('—');
  });
});
