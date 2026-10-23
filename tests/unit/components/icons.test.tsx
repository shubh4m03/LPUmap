import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CATEGORIES } from '../../../src/config/categories.ts';
import {
  Icon,
  ICON_NAMES,
  ICON_PATHS,
  iconForCategory,
  isIconName,
} from '../../../src/components/icons/index.ts';
import { circle } from '../../../src/components/icons/icon-paths.ts';

afterEach(cleanup);

const UI_ICONS = [
  'search',
  'close',
  'layers',
  'locate',
  'locate-off',
  'route',
  'swap',
  'heart',
  'heart-filled',
  'cube',
  'map-2d',
  'compass',
  'plus',
  'minus',
  'sun',
  'moon',
  'monitor',
  'menu',
  'chevron-left',
  'chevron-right',
  'chevron-down',
  'chevron-up',
  'info',
  'warning',
  'external',
  'share',
  'walk',
  'bike',
  'wheelchair',
  'steps',
  'clock',
  'phone',
  'mail',
  'globe',
  'flag',
  'trash',
  'settings',
  'reset',
  'navigation',
  'stop',
  'check',
  'wifi-off',
  'download',
  'keyboard',
  'history',
];

describe('icon set', () => {
  it('covers every CategoryDef.icon', () => {
    const missing = CATEGORIES.map((c) => c.icon).filter((n) => !isIconName(n));
    expect(missing).toEqual([]);
  });

  it('covers every required UI icon', () => {
    expect(UI_ICONS.filter((n) => !isIconName(n))).toEqual([]);
  });

  it('has well-formed path data on the 24px grid for every glyph', () => {
    for (const name of ICON_NAMES) {
      const paths = ICON_PATHS[name];
      expect(paths.length, name).toBeGreaterThan(0);
      for (const { d } of paths) {
        expect(d, name).toMatch(/^[Mm]/);
        expect(d, name).not.toMatch(/NaN|undefined/);
        // Absolute coordinates after M/L stay within the 24px box.
        for (const m of d.matchAll(/[ML]\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/g)) {
          for (const v of [Number(m[1]), Number(m[2])]) {
            expect(v, `${name}: ${d}`).toBeGreaterThanOrEqual(0);
            expect(v, `${name}: ${d}`).toBeLessThanOrEqual(24);
          }
        }
      }
    }
  });

  it('draws full circles: two half-arcs that return to the start through opposite halves', () => {
    // Endpoint-parameterised arcs between antipodal points have exactly one centre, so
    // the sweep flag alone picks the half. A→B with sweep s and B→A with sweep s covers
    // both halves; B→A with the opposite sweep retraces the first half (a semicircle).
    const arcPair =
      /M(-?[\d.]+) (-?[\d.]+)a([\d.]+) \3 0 [01] ([01]) ?(-?[\d.]+) 0 \3 \3 0 [01] ([01]) ?(-?[\d.]+) 0Z/;
    const d = circle(12, 12, 7);
    const m = arcPair.exec(d);
    expect(m, d).not.toBeNull();
    expect(m![4]).toBe(m![6]);
    expect(Number(m![5])).toBe(-14);
    expect(Number(m![7])).toBe(14);

    let circles = 0;
    for (const name of ICON_NAMES) {
      for (const { d: path } of ICON_PATHS[name]) {
        const pair = arcPair.exec(path);
        if (!pair) continue;
        circles++;
        expect(pair[4], `${name}: ${path}`).toBe(pair[6]);
        expect(Number(pair[5]) + Number(pair[7]), `${name}: ${path}`).toBe(0);
      }
    }
    // search, info, clock, globe, pin, ball ... all rely on circle().
    expect(circles).toBeGreaterThan(15);
  });

  it('maps unknown category icons to the generic pin', () => {
    expect(iconForCategory('bed')).toBe('bed');
    expect(iconForCategory('rocket')).toBe('pin');
    expect(iconForCategory('constructor')).toBe('pin');
  });
});

describe('<Icon>', () => {
  it('is decorative (aria-hidden, no role) by default', () => {
    const { container } = render(<Icon name="search" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).not.toHaveAttribute('role');
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg).toHaveAttribute('stroke-width', '1.75');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
  });

  it('becomes a labelled image when given a title', () => {
    render(<Icon name="wheelchair" title="Step-free access" />);
    expect(screen.getByRole('img', { name: 'Step-free access' })).toBeInTheDocument();
  });

  it('fills solid parts with currentColor', () => {
    const { container } = render(<Icon name="heart-filled" size={24} />);
    expect(container.querySelector('path')).toHaveAttribute('fill', 'currentColor');
    expect(container.querySelector('svg')).toHaveAttribute('width', '24');
  });
});
