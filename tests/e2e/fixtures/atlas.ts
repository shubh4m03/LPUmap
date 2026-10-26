/**
 * Page object for LPU Campus Atlas. Locators are by role and accessible name;
 * map state is read through the read-only `window.__ATLAS_MAP__` hook that the
 * app installs when the URL carries `?e2e=1`.
 */
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { LngLat } from '../../../src/data/schema.ts';
import type { MapCamera } from '../../../src/map/types.ts';
import type { Health } from './test.ts';

/** Mirrors MOBILE_BREAKPOINT_PX in src/accessibility/useMediaQuery.ts. */
const MOBILE_BREAKPOINT_PX = 768;

export const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class Atlas {
  readonly page: Page;
  readonly testInfo: TestInfo;
  readonly health: Health;

  constructor(page: Page, testInfo: TestInfo, health: Health) {
    this.page = page;
    this.testInfo = testInfo;
    this.health = health;
  }

  get isMobile(): boolean {
    return (this.page.viewportSize()?.width ?? 1024) < MOBILE_BREAKPOINT_PX;
  }

  // ---------------------------------------------------------------- loading

  /** Opens the app in e2e mode (extra query params optional) and waits until the map is usable. */
  async open(params: Record<string, string> = {}): Promise<void> {
    const qs = new URLSearchParams({ e2e: '1', ...params });
    await this.page.goto(`/?${qs.toString()}`);
    await this.waitForMapReady();
  }

  async waitForMapReady(): Promise<void> {
    await this.page.waitForFunction(() => window.__ATLAS_MAP__?.isStyleLoaded() === true, null, {
      timeout: 30_000,
    });
    const canvas = this.mapCanvas;
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(0);
    expect(box?.height ?? 0).toBeGreaterThan(0);
  }

  /** Opens the app in e2e mode in the isometric overview (`?view=iso`) and waits until it has drawn. */
  async openOverview(params: Record<string, string> = {}): Promise<void> {
    const qs = new URLSearchParams({ e2e: '1', view: 'iso', ...params });
    await this.page.goto(`/?${qs.toString()}`);
    await this.waitForOverviewReady();
  }

  /**
   * Waits for the MAP-ACCURATE overview (window.__ATLAS_ISO__). The isometric mode opens on the
   * owner's illustration by default (docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md §3); the checks that
   * use this helper are about the footprint drawing, so it chooses that variant when the
   * illustration is shown (tests/e2e/isometric-art.spec.ts covers the illustration).
   */
  async waitForOverviewReady(): Promise<void> {
    const art = this.page.getByTestId('art-view');
    await expect(art.or(this.page.getByTestId('iso-view')).first()).toBeVisible({ timeout: 30_000 });
    if (await art.isVisible())
      await this.page
        .getByRole('radiogroup', { name: 'Overview style' })
        .getByRole('radio', { name: 'Map-accurate' })
        .click();
    await this.page.waitForFunction(
      () => (window.__ATLAS_ISO__?.getFrameStats().fullRedraws ?? 0) > 0,
      null,
      {
        timeout: 30_000,
      },
    );
    await expect(this.page.getByTestId('iso-view')).toBeVisible();
  }

  /** The view-mode radio group in the map controls. */
  get viewModes(): Locator {
    return this.page.getByRole('radiogroup', { name: 'View mode' });
  }

  /** Chooses a mode in the switcher and waits until that view is ready. */
  async switchView(name: '3D map' | 'Isometric overview' | '2D map'): Promise<void> {
    const radio = this.viewModes.getByRole('radio', { name });
    await radio.click();
    await expect(radio).toHaveAttribute('aria-checked', 'true');
    if (name === 'Isometric overview') await this.waitForOverviewReady();
    else await this.waitForMapReady();
  }

  isoSelectedId(): Promise<string | null> {
    return this.page.evaluate(() => window.__ATLAS_ISO__!.getSelectedId());
  }
  isoDrawOrder(): Promise<string[]> {
    return this.page.evaluate(() => window.__ATLAS_ISO__!.getDrawOrder());
  }

  /** Saves a full-page screenshot under test-results (for review) and attaches it to the report. */
  async saveScreenshot(name: string): Promise<string> {
    const path = this.testInfo.outputPath(`${name}.png`);
    await this.page.screenshot({ path, animations: 'disabled' });
    await this.testInfo.attach(name, { path, contentType: 'image/png' });
    return path;
  }

  get mapCanvas(): Locator {
    return this.page.getByTestId('atlas-map').locator('canvas');
  }

  // ---------------------------------------------------------- map hook reads

  camera(): Promise<MapCamera> {
    return this.page.evaluate(() => window.__ATLAS_MAP__!.getCamera());
  }
  selectedId(): Promise<string | null> {
    return this.page.evaluate(() => window.__ATLAS_MAP__!.getSelectedId());
  }
  routeCoordinateCount(): Promise<number> {
    return this.page.evaluate(() => window.__ATLAS_MAP__!.getRouteCoordinateCount());
  }
  userLocationShown(): Promise<boolean> {
    return this.page.evaluate(() => window.__ATLAS_MAP__!.isUserLocationShown());
  }
  renderedBuildingIds(): Promise<string[]> {
    return this.page.evaluate(() => window.__ATLAS_MAP__!.queryRenderedBuildingIds());
  }
  layerVisibility(id: string): Promise<'visible' | 'none' | null> {
    return this.page.evaluate((layer) => window.__ATLAS_MAP__!.getLayerVisibility(layer), id);
  }
  project(lngLat: LngLat): Promise<{ x: number; y: number } | null> {
    return this.page.evaluate((p) => window.__ATLAS_MAP__!.projectToViewport(p), lngLat);
  }

  // ------------------------------------------------------------------ search

  get palette(): Locator {
    return this.page.getByRole('dialog', { name: 'Search the campus atlas' });
  }

  /** Ctrl/⌘+K on a desktop layout; the search pill on the phone layout. */
  async openSearch(): Promise<Locator> {
    if (this.isMobile) {
      await this.page.getByRole('button', { name: /^Search places/ }).click();
    } else {
      await this.page.keyboard.press('ControlOrMeta+k');
    }
    await expect(this.palette).toBeVisible();
    return this.palette;
  }

  /** The palette option whose accessible name starts with `title` followed by its subtitle. */
  paletteOption(title: string): Locator {
    return this.palette.getByRole('option', { name: new RegExp(`^${escapeRegExp(title)}( |$)`) }).first();
  }

  async searchAndChoose(title: string): Promise<void> {
    const palette = await this.openSearch();
    await palette.getByRole('combobox').fill(title);
    const option = this.paletteOption(title);
    await expect(option).toBeVisible();
    await option.click();
    await expect(this.palette).toBeHidden();
  }

  // ------------------------------------------------------------------ panels

  /** The open panel: the side panel on wider screens, the bottom sheet on phones. */
  panel(name: string | RegExp): Locator {
    return this.isMobile
      ? this.page.getByRole('region', { name }).or(this.page.getByRole('dialog', { name }))
      : this.page.getByRole('complementary', { name });
  }

  placeArticle(name: string): Locator {
    return this.page.getByRole('article', { name });
  }

  async closePanel(panel: Locator): Promise<void> {
    await panel.getByRole('button', { name: /^Close( panel)?$/ }).click();
    await expect(panel).toBeHidden();
  }

  async dismissToasts(): Promise<void> {
    const region = this.page.getByRole('region', { name: 'Notifications' });
    const buttons = region.getByRole('button', { name: 'Dismiss notification' });
    while ((await buttons.count()) > 0) await buttons.first().click();
  }

  // ------------------------------------------------------------- evidence

  async screenshot(name: string): Promise<void> {
    await this.testInfo.attach(name, {
      body: await this.page.screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    });
  }
}
