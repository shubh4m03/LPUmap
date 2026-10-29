/**
 * Transient toasts never cover the map attribution: the toast stack is lifted
 * above the attribution's MEASURED top edge (an imagery credit such as Esri's
 * wraps over two or three lines on a phone, which a fixed one-line clearance
 * did not clear — QA defect D5).
 */
import { act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileLayout } from '../../../src/components/layout/MobileLayout.tsx';
import { DesktopLayout } from '../../../src/components/layout/DesktopLayout.tsx';
import { QUICKBAR_PX } from '../../../src/components/layout/map-padding.ts';
import {
  ATTRIBUTION_CLEARANCE_PX,
  ATTRIBUTION_GAP_PX,
  aboveAttributionPx,
  mobileToastOffsetPx,
  toastOffsetPx,
} from '../../../src/components/layout/toast-offset.ts';
import { renderWithAtlas, resetAppStore } from '../app/render-helpers.tsx';

const VIEWPORT_H = 844;
/** Three lines of Esri credit above the quick-actions bar. */
const ATTRIB_HEIGHT = 74;
const ATTRIB_TOP = VIEWPORT_H - QUICKBAR_PX - ATTRIB_HEIGHT;

describe('toast offset above the attribution (pure)', () => {
  it('clears the measured top edge with a gap, and is null without an attribution', () => {
    expect(aboveAttributionPx(VIEWPORT_H, ATTRIB_TOP)).toBe(QUICKBAR_PX + ATTRIB_HEIGHT + ATTRIBUTION_GAP_PX);
    expect(aboveAttributionPx(VIEWPORT_H, null)).toBeNull();
    expect(aboveAttributionPx(VIEWPORT_H, VIEWPORT_H + 10)).toBeNull();
    expect(aboveAttributionPx(VIEWPORT_H, 0)).toBeNull();
  });

  it('never goes below the layout offset (sheet, quick-actions bar)', () => {
    const base = mobileToastOffsetPx(VIEWPORT_H, false, 'half');
    expect(toastOffsetPx(base, VIEWPORT_H, null)).toBe(base);
    expect(toastOffsetPx(base, VIEWPORT_H, VIEWPORT_H - 20)).toBe(base);
    expect(toastOffsetPx(base, VIEWPORT_H, ATTRIB_TOP)).toBeGreaterThan(base);
  });
});

const realRect = Element.prototype.getBoundingClientRect;
let attribHeight = ATTRIB_HEIGHT;
/** Top of a `data-toast-clearance` element (null: none measured). */
let clearanceTop: number | null = null;

beforeEach(() => {
  resetAppStore();
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: VIEWPORT_H });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (clearanceTop !== null && this.hasAttribute('data-toast-clearance')) {
      const top = clearanceTop;
      return {
        x: 0,
        y: top,
        top,
        left: 0,
        right: 390,
        bottom: top + 280,
        width: 390,
        height: 280,
      } as DOMRect;
    }
    if (this.classList.contains('maplibregl-ctrl-attrib')) {
      const top = VIEWPORT_H - QUICKBAR_PX - attribHeight;
      return {
        x: 8,
        y: top,
        top,
        left: 8,
        right: 382,
        bottom: top + attribHeight,
        width: 374,
        height: attribHeight,
        toJSON() {},
      } as DOMRect;
    }
    return realRect.call(this);
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  attribHeight = ATTRIB_HEIGHT;
  clearanceTop = null;
});

const offset = () => parseFloat(document.documentElement.style.getPropertyValue('--ds-toast-offset'));
const fakeMap = (
  <div className="maplibregl-ctrl-bottom-right">
    <div className="maplibregl-ctrl-attrib">
      Powered by Esri | Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community
    </div>
  </div>
);

describe('layouts lift the toast stack above the attribution', () => {
  it('phone: a wrapped three-line credit is cleared (the toast bottom is above its top edge)', async () => {
    renderWithAtlas(<MobileLayout map={fakeMap} />);
    await act(async () => new Promise((r) => requestAnimationFrame(() => r(undefined))));
    // The toast stack's bottom edge sits at viewportH - offset: above the attribution's top.
    expect(VIEWPORT_H - offset()).toBeLessThanOrEqual(ATTRIB_TOP - ATTRIBUTION_GAP_PX);
    expect(offset()).toBeGreaterThan(QUICKBAR_PX + ATTRIBUTION_CLEARANCE_PX);
  });

  it('phone: content marked data-toast-clearance (the illustration card) is cleared too', async () => {
    const cardTop = 420;
    clearanceTop = cardTop;
    const withCard = (
      <>
        {fakeMap}
        <div data-toast-clearance="">Illustration detail card</div>
      </>
    );
    renderWithAtlas(<MobileLayout map={withCard} />);
    await act(async () => new Promise((r) => requestAnimationFrame(() => r(undefined))));
    expect(VIEWPORT_H - offset()).toBeLessThanOrEqual(cardTop - ATTRIBUTION_GAP_PX);
  });

  it('desktop: the stack also follows a taller attribution', async () => {
    attribHeight = 60;
    renderWithAtlas(<DesktopLayout map={fakeMap} />);
    await act(async () => new Promise((r) => requestAnimationFrame(() => r(undefined))));
    expect(VIEWPORT_H - offset()).toBeLessThanOrEqual(VIEWPORT_H - QUICKBAR_PX - 60 - ATTRIBUTION_GAP_PX);
  });
});
