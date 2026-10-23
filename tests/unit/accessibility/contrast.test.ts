import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONTRAST_PAIRS,
  contrastRatio,
  cssRuleBody,
  parseHex,
  parseHexDeclarations,
  parseThemeTokens,
  relativeLuminance,
  THEME_SELECTORS,
} from '../../../src/styles/contrast.ts';
import { THEME_COLORS } from '../../../src/accessibility/theme.ts';

// Vitest runs from the repository root (jsdom makes import.meta.url non-file).
const tokensCss = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
const tokens = parseThemeTokens(tokensCss);

describe('contrast math', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // Known value: #767676 on white is the classic 4.54:1 grey.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 5);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#c2410c', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#c2410c'), 10);
  });

  it('rejects non-hex input instead of guessing', () => {
    expect(parseHex('rgb(0 0 0)')).toBeNull();
    expect(parseHex('#12345')).toBeNull();
    expect(() => relativeLuminance('red')).toThrow(/Not a hex colour/);
  });
});

describe('CSS block parsing', () => {
  const css = `/* :root { --ds-x: #000; } */
@media (min-width: 1px) { .a { color: red; } }
:root { --ds-a: #ABC; --ds-b: rgb(0 0 0 / 0.5); --ds-c: #112233; }
.b:not(.c) { --ds-a: #fff; }`;

  it('finds a rule by exact selector, skipping comments and nested at-rules', () => {
    expect(cssRuleBody(css, ':root')).toContain('--ds-a: #ABC');
    expect(cssRuleBody(css, '.b:not(.c)')).toContain('#fff');
    expect(cssRuleBody(css, '.a')).toContain('color: red');
    expect(cssRuleBody(css, '.missing')).toBeNull();
    expect(cssRuleBody('.x { --ds-a: #fff;', '.x')).toBeNull();
  });

  it('reads only hex declarations, lower-cased', () => {
    expect(parseHexDeclarations(cssRuleBody(css, ':root')!)).toEqual({ a: '#abc', c: '#112233' });
  });
});

describe('token parsing', () => {
  it('reads light and dark values for every colour token', () => {
    expect(Object.keys(tokens.light).length).toBeGreaterThanOrEqual(20);
    expect(Object.keys(tokens.light).sort()).toEqual(Object.keys(tokens.dark).sort());
    expect(tokens.light['surface']).toBe('#ffffff');
  });

  it('declares every token required by the design system', () => {
    for (const name of [
      'surface',
      'surface-raised',
      'surface-sunken',
      'border',
      'text',
      'text-muted',
      'text-subtle',
      'accent',
      'accent-contrast',
      'focus-ring',
      'success',
      'warning',
      'danger',
      'info',
    ]) {
      expect(tokens.light[name], name).toBeDefined();
    }
    expect(tokensCss).toMatch(/--ds-overlay:/);
  });

  it('keeps the brand theme colour as the light accent', () => {
    expect(tokens.light['accent']).toBe('#c2410c');
  });

  it('keeps theme-color meta values in sync with the surface tokens', () => {
    expect(THEME_COLORS.light).toBe(tokens.light['surface']);
    expect(THEME_COLORS.dark).toBe(tokens.dark['surface']);
  });

  it('does not depend on light-dark(), which older Tailwind-4-capable browsers lack', () => {
    expect(tokensCss.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/light-dark\(/);
  });

  it('keeps the OS-dark block identical to the pinned dark block, including scrim and shadows', () => {
    const allDecls = (body: string | null) =>
      Object.fromEntries(
        [...(body ?? '').matchAll(/(--ds-[a-z0-9-]+|color-scheme)\s*:\s*([^;]+);/g)].map((m) => [
          m[1],
          m[2]!.replace(/\s+/g, ' ').trim(),
        ]),
      );
    const dark = allDecls(cssRuleBody(tokensCss, THEME_SELECTORS.dark));
    const system = allDecls(cssRuleBody(tokensCss, THEME_SELECTORS.systemDark));
    const light = allDecls(cssRuleBody(tokensCss, THEME_SELECTORS.light));
    expect(Object.keys(dark).length).toBeGreaterThan(25);
    expect(system).toEqual(dark);
    // Every themed token has a value in both themes.
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
    expect(dark['color-scheme']).toBe('dark');
    expect(light['color-scheme']).toBe('light');
    // The OS rule must sit inside the prefers-color-scheme media query.
    const media = cssRuleBody(tokensCss, '@media (prefers-color-scheme: dark)');
    expect(media).toContain(THEME_SELECTORS.systemDark);
  });

  it('zeroes motion durations under prefers-reduced-motion', () => {
    const block = /@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*?)}\s*}/.exec(tokensCss)?.[1] ?? '';
    for (const d of ['fast', 'base', 'slow']) expect(block).toMatch(new RegExp(`--ds-duration-${d}: 0ms`));
  });
});

describe.each(['light', 'dark'] as const)('WCAG 2.2 AA contrast (%s theme)', (theme) => {
  it.each(CONTRAST_PAIRS.map((p) => [`${p.fg} on ${p.bg} (${p.usage})`, p] as const))(
    '%s',
    (_label, pair) => {
      const fg = tokens[theme][pair.fg];
      const bg = tokens[theme][pair.bg];
      expect(fg, `missing token ${pair.fg}`).toBeDefined();
      expect(bg, `missing token ${pair.bg}`).toBeDefined();
      const ratio = contrastRatio(fg!, bg!);
      expect(ratio, `${pair.fg} ${fg} on ${pair.bg} ${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(
        pair.min,
      );
    },
  );
});
