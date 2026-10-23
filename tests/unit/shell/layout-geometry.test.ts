import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MOBILE_TOP_PX, mobilePadding, QUICKBAR_PX } from '../../../src/components/layout/map-padding.ts';
import {
  ATTRIBUTION_CLEARANCE_PX,
  mobileToastOffsetPx,
} from '../../../src/components/layout/toast-offset.ts';
import { snapHeightsPx } from '../../../src/components/ui/index.ts';

const VIEWPORT_H = 844;

describe('mobile map padding', () => {
  it('without a navigation card keeps the default top inset', () => {
    expect(mobilePadding(VIEWPORT_H, 0, 0)).toEqual({ top: MOBILE_TOP_PX, right: 60, bottom: 16, left: 16 });
  });

  it('includes the navigation card, so the user dot is never under it', () => {
    const p = mobilePadding(VIEWPORT_H, 68, 180);
    // The card's top edge is at MOBILE_TOP_PX; the padded area starts below its bottom edge.
    expect(p.top).toBeGreaterThanOrEqual(MOBILE_TOP_PX + 180);
    expect(p.bottom).toBe(68 + 16);
  });

  it('caps the top inset so some map stays visible between card and sheet', () => {
    const cover = snapHeightsPx(VIEWPORT_H).half - QUICKBAR_PX;
    const p = mobilePadding(VIEWPORT_H, cover, 380);
    expect(VIEWPORT_H - QUICKBAR_PX - p.top - p.bottom).toBeGreaterThanOrEqual(48);
    expect(p.top).toBeGreaterThanOrEqual(MOBILE_TOP_PX);
  });
});

describe('mobile toast offset', () => {
  const heights = snapHeightsPx(VIEWPORT_H);

  it('keeps toasts above the quick-actions bar and the attribution when no sheet is open', () => {
    expect(mobileToastOffsetPx(VIEWPORT_H, false, 'half')).toBe(QUICKBAR_PX + ATTRIBUTION_CLEARANCE_PX);
  });

  it('places toasts above the sheet peek and the attribution lifted above it', () => {
    expect(mobileToastOffsetPx(VIEWPORT_H, true, 'peek')).toBe(heights.peek + ATTRIBUTION_CLEARANCE_PX);
    expect(mobileToastOffsetPx(VIEWPORT_H, true, 'half')).toBe(
      Math.round(heights.half + ATTRIBUTION_CLEARANCE_PX),
    );
    // A full-height sheet: toasts sit at peek height rather than riding up over its header.
    expect(mobileToastOffsetPx(VIEWPORT_H, true, 'full')).toBe(heights.peek + ATTRIBUTION_CLEARANCE_PX);
  });
});

describe('programmatic heading focus', () => {
  it('never draws the focus ring on tabindex=-1 headings', () => {
    const css = readFileSync('src/styles/index.css', 'utf8');
    expect(css).toMatch(
      /:is\(h1, h2, h3, h4, h5, h6, \[data-panel-focus\]\)\[tabindex='-1'\]:focus\s*\{\s*outline: none;/,
    );
  });
});
