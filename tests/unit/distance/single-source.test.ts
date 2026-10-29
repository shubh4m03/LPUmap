// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * G-21: src/distance is the single home of geodesy. Outside it, no code may
 * hard-code the mean Earth radius or a metres-per-degree factor; it imports
 * EARTH_RADIUS_M / createLocalProjection / destinationPoint instead. (Web
 * Mercator's equatorial 6 378 137 m is a different, projection-defined
 * constant and is not matched.)
 */
const FORBIDDEN = /\b(?:6_?371_?008(?:\.\d+)?|111_?(?:320|319|195|000|111|139)(?:\.\d+)?)\b/;

/**
 * Known remaining use owned by another workstream (routing; src/routing/** is
 * outside this change): snap.ts sizes its own grid search box with 1/111 000.
 * Remove the entry when snap.ts moves onto src/distance.
 */
const PENDING = new Set(['src/routing/snap.ts']);

const root = process.cwd();

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(?:ts|tsx)$/.test(n) ? [relative(root, p).split('\\').join('/')] : [];
  });
}

describe('one geodesy implementation (src/distance)', () => {
  it('no source file outside src/distance hard-codes the Earth radius or metres per degree', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(root, 'src'))) {
      if (file.startsWith('src/distance/') || PENDING.has(file)) continue;
      readFileSync(join(root, file), 'utf8')
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (FORBIDDEN.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it('the pattern catches the forms that were duplicated before', () => {
    for (const s of ['northM / 111_320', '1 / 111000', 'EARTH_RADIUS_M = 6371008.8', 'R = 6_371_008.8'])
      expect(FORBIDDEN.test(s), s).toBe(true);
    expect(FORBIDDEN.test('(2 * Math.PI * 6_378_137) / 512')).toBe(false);
  });
});
