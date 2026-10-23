import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FONT_BOLD, FONT_REGULAR } from '../../../src/map/overlay-layers.ts';

const FONTS_DIR = resolve(__dirname, '../../../public/fonts');
const RANGES = ['0-255', '256-511', '8192-8447'];

describe('self-hosted glyphs', () => {
  it.each([...FONT_REGULAR, ...FONT_BOLD])('ships every range the labels need for "%s"', (fontstack) => {
    for (const range of RANGES) {
      const file = resolve(FONTS_DIR, fontstack, `${range}.pbf`);
      expect(existsSync(file), file).toBe(true);
      expect(statSync(file).size).toBeGreaterThan(1000);
      // A glyph PBF starts with field 1 (fontstack message) and names the font inside.
      const head = readFileSync(file).subarray(0, 64);
      expect(head[0]).toBe(0x0a);
      expect(head.toString('latin1')).toContain(fontstack.replace(/ (Regular|Bold)$/, ''));
    }
  });

  it('documents provenance and the font licence', () => {
    expect(readFileSync(resolve(FONTS_DIR, 'LICENSE.txt'), 'utf8')).toContain(
      'SIL OPEN FONT LICENSE Version 1.1',
    );
    const source = readFileSync(resolve(FONTS_DIR, 'SOURCE.md'), 'utf8');
    expect(source).toMatch(/demotiles\.maplibre\.org/);
    expect(source).toMatch(/2026-10-23/);
  });
});
