/**
 * WCAG 2.2 contrast helpers plus a tiny parser for the per-theme colour blocks in
 * tokens.css. Pure (no DOM) so the token contrast test can run anywhere.
 */

export type ThemeName = 'light' | 'dark';

export interface ContrastPair {
  fg: string;
  bg: string;
  /** 4.5 for body text, 3 for large text and UI component boundaries. */
  min: 4.5 | 3;
  usage: string;
}

/** Text and UI pairs the components actually render. Token names omit the `--ds-` prefix. */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { fg: 'text', bg: 'surface', min: 4.5, usage: 'body text' },
  { fg: 'text', bg: 'surface-raised', min: 4.5, usage: 'panel text' },
  { fg: 'text', bg: 'surface-sunken', min: 4.5, usage: 'input text' },
  { fg: 'text', bg: 'surface-hover', min: 4.5, usage: 'hovered row text' },
  { fg: 'text', bg: 'highlight', min: 4.5, usage: 'search match highlight' },
  { fg: 'text-muted', bg: 'surface', min: 4.5, usage: 'secondary text' },
  { fg: 'text-muted', bg: 'surface-raised', min: 4.5, usage: 'secondary text on panels' },
  { fg: 'text-muted', bg: 'surface-sunken', min: 4.5, usage: 'secondary text in inputs' },
  { fg: 'text-muted', bg: 'surface-hover', min: 4.5, usage: 'hovered row subtitle' },
  { fg: 'text-subtle', bg: 'surface', min: 4.5, usage: 'meta text' },
  { fg: 'text-subtle', bg: 'surface-raised', min: 4.5, usage: 'meta text on panels' },
  { fg: 'text-subtle', bg: 'surface-sunken', min: 4.5, usage: 'placeholder text' },
  { fg: 'accent-contrast', bg: 'accent', min: 4.5, usage: 'primary button label' },
  { fg: 'accent-contrast', bg: 'accent-hover', min: 4.5, usage: 'primary button hover label' },
  { fg: 'accent', bg: 'surface', min: 4.5, usage: 'accent text / links' },
  { fg: 'accent', bg: 'surface-raised', min: 4.5, usage: 'accent text on panels' },
  { fg: 'accent-text', bg: 'accent-soft', min: 4.5, usage: 'selected chip / accent badge' },
  { fg: 'accent-text', bg: 'surface-raised', min: 4.5, usage: 'active row text' },
  { fg: 'focus-ring', bg: 'surface', min: 3, usage: 'focus indicator' },
  { fg: 'focus-ring', bg: 'surface-raised', min: 3, usage: 'focus indicator on panels' },
  { fg: 'focus-ring', bg: 'surface-sunken', min: 3, usage: 'focus indicator on inputs' },
  { fg: 'border-strong', bg: 'surface', min: 3, usage: 'control boundary' },
  { fg: 'border-strong', bg: 'surface-raised', min: 3, usage: 'control boundary on panels' },
  { fg: 'border-strong', bg: 'surface-sunken', min: 3, usage: 'input boundary' },
  { fg: 'success', bg: 'surface-raised', min: 4.5, usage: 'success text' },
  { fg: 'success', bg: 'success-soft', min: 4.5, usage: 'verified badge' },
  { fg: 'warning', bg: 'surface-raised', min: 4.5, usage: 'warning text' },
  { fg: 'warning', bg: 'warning-soft', min: 4.5, usage: 'estimated badge' },
  { fg: 'danger', bg: 'surface-raised', min: 4.5, usage: 'error text' },
  { fg: 'danger', bg: 'danger-soft', min: 4.5, usage: 'danger badge' },
  { fg: 'info', bg: 'surface-raised', min: 4.5, usage: 'info text' },
  { fg: 'info', bg: 'info-soft', min: 4.5, usage: 'imported badge' },
  { fg: 'surface', bg: 'danger', min: 4.5, usage: 'danger button label' },
];

/** Parses `#rgb` or `#rrggbb` into 0–255 channels; returns null for anything else. */
export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) throw new Error(`Not a hex colour: ${hex}`);
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Selectors of the theme blocks in tokens.css (see the header comment there). */
export const THEME_SELECTORS = {
  light: ":root,\n:root[data-theme='light']",
  dark: ":root[data-theme='dark']",
  systemDark: ":root:not([data-theme='light'])",
} as const;

/**
 * Body of the first rule whose selector is exactly `selector` (comments stripped,
 * whitespace-normalised), or null when absent. Brace-matched, so nested at-rules
 * before it are skipped correctly.
 */
export function cssRuleBody(css: string, selector: string): string | null {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const want = selector.replace(/\s+/g, ' ').trim();
  let start = 0;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === ';') start = i + 1;
    else if (ch === '}') start = i + 1;
    else if (ch === '{') {
      const sel = clean.slice(start, i).replace(/\s+/g, ' ').trim();
      if (sel === want) {
        let depth = 1;
        for (let j = i + 1; j < clean.length; j++) {
          if (clean[j] === '{') depth++;
          else if (clean[j] === '}' && --depth === 0) return clean.slice(i + 1, j);
        }
        return null;
      }
      start = i + 1;
    }
  }
  return null;
}

/** `--ds-name: #hex` declarations in a rule body (other values such as rgb() are skipped). */
export function parseHexDeclarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--ds-([a-z0-9-]+)\s*:\s*(#[0-9a-f]{3,6})\s*;/gi)) {
    const [, name, value] = m;
    if (name && value) out[name] = value.toLowerCase();
  }
  return out;
}

/** Light and dark hex colour tokens from tokens.css. Missing blocks yield empty maps. */
export function parseThemeTokens(css: string): Record<ThemeName, Record<string, string>> {
  return {
    light: parseHexDeclarations(cssRuleBody(css, THEME_SELECTORS.light) ?? ''),
    dark: parseHexDeclarations(cssRuleBody(css, THEME_SELECTORS.dark) ?? ''),
  };
}
