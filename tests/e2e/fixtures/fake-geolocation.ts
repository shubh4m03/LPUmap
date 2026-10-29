/**
 * Deterministic geolocation for e2e workflows that check exact numbers.
 *
 * Chromium's emulated geolocation (context.setGeolocation) stamps each fix
 * with the real wall clock, so distances that depend on fix timing (the
 * tracker smooths fixes that arrive close together) would vary run to run.
 * Here `navigator.geolocation` is replaced by a stand-in the test drives, and
 * the page clock is frozen with `page.clock.setFixedTime` before every fix, so
 * the app sees exactly the timestamps the test chose. Timers keep running, so
 * the map and React render normally.
 *
 * Nothing here talks to a real location service.
 */
import type { Page } from '@playwright/test';
import type { LngLat } from '../../../src/data/schema.ts';

declare global {
  interface Window {
    __FAKE_GEO__?: {
      push(lng: number, lat: number, accuracy: number): void;
      watchCount(): number;
    };
  }
}

/** Installs the stand-in before any app script runs. Call before `atlas.open()`. */
export async function installFakeGeolocation(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Ok = (p: GeolocationPosition) => void;
    const watches = new Map<number, Ok>();
    let next = 1;
    let last: GeolocationPosition | null = null;
    const deliverLater = (ok: Ok) =>
      setTimeout(() => {
        if (last) ok(last);
      }, 0);
    const fake: Geolocation = {
      watchPosition(ok) {
        const id = next++;
        watches.set(id, ok);
        if (last) deliverLater(ok);
        return id;
      },
      clearWatch(id) {
        watches.delete(id);
      },
      getCurrentPosition(ok) {
        deliverLater(ok);
      },
    };
    Object.defineProperty(Navigator.prototype, 'geolocation', { configurable: true, get: () => fake });
    window.__FAKE_GEO__ = {
      push(lng, lat, accuracy) {
        const coords = {
          longitude: lng,
          latitude: lat,
          accuracy,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        };
        last = {
          coords: { ...coords, toJSON: () => coords },
          timestamp: Date.now(),
          toJSON: () => ({ coords, timestamp: Date.now() }),
        } as unknown as GeolocationPosition;
        for (const ok of [...watches.values()]) ok(last);
      },
      watchCount: () => watches.size,
    };
  });
}

/** Freezes the page clock at `timeMs`, then delivers one fix stamped with that time. */
export async function pushFix(page: Page, timeMs: number, p: LngLat, accuracyM = 10): Promise<void> {
  await page.clock.setFixedTime(timeMs);
  await page.evaluate(({ lng, lat, acc }) => window.__FAKE_GEO__!.push(lng, lat, acc), {
    lng: p[0],
    lat: p[1],
    acc: accuracyM,
  });
}

export const fakeWatchCount = (page: Page) => page.evaluate(() => window.__FAKE_GEO__!.watchCount());
