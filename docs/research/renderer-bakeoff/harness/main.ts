/**
 * Gate 3 bake-off harness page (research only; never part of the app build).
 *
 *   ?renderer=baseline   app map, no studio instances
 *   ?renderer=extrusion  studio instances as plain fill-extrusions (path a)
 *   ?renderer=custom     studio instances through the WebGL2 custom layer (path b,
 *                        the app's own attachRealistic3D controller)
 *   ?renderer=iso        the isometric overview's Canvas2D IsoView with the same
 *                        studio meshes (path c, the isometric agent's code, unmodified)
 *   &n=50                instances (≤ 50)   &theme=light|dark
 *
 * Everything else is the app's own code and data: loadCampusData, buildMapStyle,
 * poiCollection, pickPlaceId. window.__BAKEOFF__ is the driver API for the
 * Playwright spec in this folder.
 */
import { Map as MapLibreMap, type CustomLayerInterface, type CustomRenderMethodInput } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './harness.css';
import '../../../../src/app/maplibre-worker.ts';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { generateStudioMesh, fallbackPrismMesh } from '../../../../src/building-studio/mesh/generate.ts';
import {
  modelSupport,
  APPEARANCE_LABEL,
  VERIFICATION_LABELS,
} from '../../../../src/building-studio/schema.ts';
import { instanceMatrix, transformPoint } from '../../../../src/building-studio/render/maplibre/placement.ts';
import { attachRealistic3D, type Realistic3DHandle } from '../../../../src/buildings3d/realistic3d.ts';
import { LAYER_GROUPS, type LayerGroupId } from '../../../../src/config/categories.ts';
import { APP_CONFIG } from '../../../../src/config/index.ts';
import { createOptionalLoaders, loadCampusData } from '../../../../src/data/loader.ts';
import { detectionAttributionHtml } from '../../../../src/buildings3d/optional-layers.ts';
import type { LngLat } from '../../../../src/data/schema.ts';
import { IsoView } from '../../../../src/isometric/IsoView.tsx';
import type { IsoStudioModel } from '../../../../src/isometric/scene.ts';
import { anchoredOrganizations, emptyCollection, poiCollection } from '../../../../src/map/geojson.ts';
import { pickPlaceId } from '../../../../src/map/picking.ts';
import { buildMapStyle, glyphsUrl, OSM_ATTRIBUTION_HTML } from '../../../../src/map/style.ts';
import {
  buildScenario,
  lightCheckScenario,
  REAL_STRUCTURES,
  scenarioBuildings,
  type BakeoffInstance,
} from './scenario.ts';

type Renderer = 'baseline' | 'extrusion' | 'custom' | 'iso' | 'lightcheck';

const params = new URLSearchParams(location.search);
const renderer = (params.get('renderer') ?? 'custom') as Renderer;
const count = Math.max(0, Math.min(50, Number(params.get('n') ?? 50)));
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
/** `watchdog=off` isolates renderer cost; the default keeps the app's real degradation behaviour. */
const watchdogOff = params.get('watchdog') === 'off';
const notices: string[] = [];

export interface BakeoffApi {
  renderer: Renderer;
  instances: Array<{ key: string; id: string; label: string; kind: string; anchor: LngLat; topM: number }>;
  /** Jump to a named view: 'overview' or a real-structure key A–D. */
  view(name: string): Promise<void>;
  /** Orbits the camera (or pans the overview) for `ms`, returning rAF intervals and per-frame layer CPU ms. */
  orbit(ms: number): Promise<{ intervals: number[]; layerMs: number[] }>;
  /**
   * Frames instance `index` (at `pitch`, map modes) and returns the screen point of its roof centre
   * (60 % of the body height). Clears the last selection so a missed click reads as null.
   */
  pickTarget(index: number, pitch?: number): Promise<{ x: number; y: number } | null>;
  /** Id selected by the last click (the app's own picking: pickPlaceId / the overview's hitTest). */
  lastSelected(): string | null;
  /** RGB of the rendered pixel at each [lon, lat, zMetres] (lightcheck only: needs a preserved buffer). */
  sample(
    points: Array<[number, number, number]>,
    bearing: number,
    center: LngLat,
  ): Promise<Array<number[] | null>>;
  loseContext(): boolean;
  restoreContext(): boolean;
  debug(): unknown;
  idle(): Promise<void>;
  /** Shows/hides "Unverified detected footprints" and returns the attribution control's text. */
  showDetections(visible: boolean): Promise<string>;
}

declare global {
  interface Window {
    __BAKEOFF__?: BakeoffApi;
    __BAKEOFF_ERROR__?: string;
  }
}

const VIEWS: Record<string, { center: LngLat; zoom: number }> = {
  overview: { center: [75.7032, 31.2533], zoom: 15.9 },
};

/** A point well inside a polygon: the interior grid sample farthest from every edge. */
function pointOnSurface(rings: readonly (readonly LngLat[])[]): LngLat | null {
  const outer = rings[0];
  if (!outer) return null;
  const inside = (p: LngLat) =>
    rings.reduce((acc, ring, k) => {
      let c = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i]!;
        const b = ring[j]!;
        if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0])
          c = !c;
      }
      return k === 0 ? c : acc && !c;
    }, false);
  const edgeDist = (p: LngLat) => {
    let best = Infinity;
    for (const ring of rings)
      for (let i = 0; i + 1 < ring.length; i++) {
        const a = ring[i]!;
        const b = ring[i + 1]!;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const t = Math.max(
          0,
          Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
        );
        best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
      }
    return best;
  };
  const xs = outer.map((p) => p[0]);
  const ys = outer.map((p) => p[1]);
  let best: LngLat | null = null;
  let bestD = -1;
  for (let i = 1; i < 24; i++)
    for (let j = 1; j < 24; j++) {
      const p: LngLat = [
        Math.min(...xs) + ((Math.max(...xs) - Math.min(...xs)) * i) / 24,
        Math.min(...ys) + ((Math.max(...ys) - Math.min(...ys)) * j) / 24,
      ];
      if (!inside(p)) continue;
      const d = edgeDist(p);
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
  return best;
}

function waitIdle(map: MapLibreMap): Promise<void> {
  return new Promise((resolve) => {
    if (map.loaded() && !map.isMoving()) {
      map.once('idle', () => resolve());
      map.triggerRepaint();
    } else map.once('idle', () => resolve());
  });
}

function rafLoop(ms: number, onFrame: () => void): Promise<number[]> {
  return new Promise((resolve) => {
    const intervals: number[] = [];
    const start = performance.now();
    let last = start;
    const tick = (t: number) => {
      intervals.push(t - last);
      last = t;
      onFrame();
      if (t - start < ms) requestAnimationFrame(tick);
      else resolve(intervals.slice(1));
    };
    requestAnimationFrame(tick);
  });
}

async function main(): Promise<void> {
  const data = await loadCampusData();
  const lightCheck = renderer === 'lightcheck';
  const allInstances = lightCheck
    ? lightCheckScenario(data.buildings)
    : buildScenario(data.buildings, data.boundary, count);
  const instances = allInstances;
  const buildings = renderer === 'baseline' ? data.buildings : scenarioBuildings(data.buildings, instances);
  const meta = instances.map((i) => ({
    key: i.key,
    id: i.source.publicId,
    label: i.label,
    kind: i.kind,
    // A point inside the footprint (the anchor of a U- or L-shape can fall in its courtyard or notch).
    anchor: pointOnSurface(i.source.footprint.coordinates) ?? i.config.anchor,
    topM: i.config.baseOffsetM + i.config.heightM,
  }));
  for (const r of REAL_STRUCTURES) {
    const inst = instances.find((i) => i.key === r.key);
    if (inst) VIEWS[r.key] = { center: inst.config.anchor, zoom: r.key === 'C' ? 18.6 : 18 };
  }
  const root = document.getElementById('root')!;

  if (renderer === 'iso') {
    mountIso(root, data, buildings, instances, meta);
    return;
  }

  const visibleGroups = new Set<LayerGroupId>(LAYER_GROUPS.map((g) => g.id));
  const anchored = anchoredOrganizations(data.places, data.relations);
  const footprintIds = new Set(buildings.features.map((f) => f.properties.id));
  const map = new MapLibreMap({
    container: root,
    style: buildMapStyle({
      data: { ...data, buildings },
      theme,
      mode3d: true,
      visibleGroups,
      showLabels: true,
      places: poiCollection(data.places, footprintIds, anchored),
      route: emptyCollection(),
      userLocation: emptyCollection(),
      glyphs: glyphsUrl('/', location.href),
    }),
    center: VIEWS.overview!.center,
    zoom: VIEWS.overview!.zoom,
    pitch: APP_CONFIG.map.pitch3d,
    bearing: APP_CONFIG.map.bearing3d,
    maxBounds: APP_CONFIG.map.maxBounds,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    attributionControl: { customAttribution: OSM_ATTRIBUTION_HTML },
    canvasContextAttributes: { preserveDrawingBuffer: renderer === 'lightcheck' },
  });

  // Probe: captures MapLibre's projection matrix so tests can project 3D points (roof centres).
  let mainMatrix: ArrayLike<number> | null = null;
  const probe: CustomLayerInterface = {
    id: 'bakeoff-probe',
    type: 'custom',
    renderingMode: '2d',
    render(_gl: WebGL2RenderingContext, args: CustomRenderMethodInput) {
      mainMatrix = Array.from(args.defaultProjectionData.mainMatrix as ArrayLike<number>);
    },
  };

  await new Promise<void>((resolve) => map.once('load', () => resolve()));
  map.addLayer(probe);
  let selected: string | null = null;
  map.on('click', (e) => {
    selected = pickPlaceId(map, e.point);
  });
  // Every map mode runs the app's controller (as MapView does); only 'custom' hands it studio models.
  const r3d: Realistic3DHandle = attachRealistic3D(map, {
    theme,
    mode3d: true,
    onNotice: (n) => notices.push(n.id),
    ...(watchdogOff ? { watchdog: { p95BudgetMs: Number.POSITIVE_INFINITY } } : {}),
  });
  if (renderer === 'custom') r3d.setStudioModels(instances.map((i) => i.source));
  const optional = createOptionalLoaders(data.manifest);
  if (lightCheck) {
    r3d.setStudioModels(instances.filter((i) => i.key === 'CUSTOM').map((i) => i.source));
    map.jumpTo({
      center: [75.70032, 31.2475],
      zoom: 18.3,
      pitch: 50,
      bearing: Number(params.get('bearing') ?? 0),
    });
  }
  const gl = map.getCanvas().getContext('webgl2');
  const lose = gl?.getExtension('WEBGL_lose_context') ?? null;
  // Custom layers are not restored with the style after a context loss: re-add the probe once it has loaded.
  map.on('webglcontextrestored', () => {
    const add = () => {
      if (!map.getLayer(probe.id)) map.addLayer(probe);
    };
    if (map.isStyleLoaded()) add();
    else map.once('style.load', add);
  });

  const project3d = (p: LngLat, zM: number): { x: number; y: number } | null => {
    if (!mainMatrix) return null;
    const m = instanceMatrix(mainMatrix, p);
    const c = transformPoint(m, [0, 0, zM]);
    if (!(c[3]! > 0)) return null;
    const canvas = map.getCanvas();
    return {
      x: ((c[0]! / c[3]! + 1) / 2) * canvas.clientWidth,
      y: ((1 - c[1]! / c[3]!) / 2) * canvas.clientHeight,
    };
  };

  const api: BakeoffApi = {
    renderer,
    instances: meta,
    async view(name) {
      const v = VIEWS[name] ?? VIEWS.overview!;
      map.jumpTo({
        center: v.center,
        zoom: v.zoom,
        pitch: APP_CONFIG.map.pitch3d,
        bearing: APP_CONFIG.map.bearing3d,
      });
      await waitIdle(map);
    },
    async orbit(ms) {
      const layerMs: number[] = [];
      map.easeTo({ bearing: map.getBearing() + 90, duration: ms, easing: (t) => t });
      const intervals = await rafLoop(ms, () => {
        const s = r3d.debug().layer;
        if (s) layerMs.push(s.lastRenderMs);
      });
      await waitIdle(map);
      return { intervals, layerMs };
    },
    async pickTarget(index, pitch = APP_CONFIG.map.pitch3d) {
      const i = meta[index];
      if (!i) return null;
      selected = null;
      map.jumpTo({ center: i.anchor, zoom: 17.5, pitch, bearing: APP_CONFIG.map.bearing3d });
      await waitIdle(map);
      // Projected with MapLibre's own matrix: also checks the placement math in a real browser.
      const pt = project3d(i.anchor, i.topM * 0.6);
      if (!pt) return null;
      const r = map.getCanvas().getBoundingClientRect();
      return { x: r.left + pt.x, y: r.top + pt.y };
    },
    lastSelected: () => selected,
    async sample(points, bearing, center) {
      map.jumpTo({ bearing, center });
      await waitIdle(map);
      const canvas = map.getCanvas();
      const c2 = document.createElement('canvas');
      c2.width = canvas.width;
      c2.height = canvas.height;
      const ctx = c2.getContext('2d')!;
      ctx.drawImage(canvas, 0, 0);
      const scale = canvas.width / canvas.clientWidth;
      return points.map(([lon, lat, z]) => {
        const pt = project3d([lon, lat], z);
        if (!pt) return null;
        const d = ctx.getImageData(Math.round(pt.x * scale), Math.round(pt.y * scale), 1, 1).data;
        return [d[0]!, d[1]!, d[2]!];
      });
    },
    loseContext() {
      if (!lose) return false;
      lose.loseContext();
      return true;
    },
    restoreContext() {
      if (!lose) return false;
      lose.restoreContext();
      return true;
    },
    debug: () => ({ r3d: r3d.debug() ?? null, notices: [...notices] }),
    async showDetections(visible) {
      const file = visible ? await optional.detections() : null;
      r3d.setDetections(visible, file, detectionAttributionHtml(data.manifest.sources));
      await waitIdle(map);
      return document.querySelector('.maplibregl-ctrl-attrib-inner')?.textContent ?? '';
    },
    idle: () => waitIdle(map),
  };
  window.__BAKEOFF__ = api;
}

function mountIso(
  root: HTMLElement,
  data: Awaited<ReturnType<typeof loadCampusData>>,
  buildings: Awaited<ReturnType<typeof loadCampusData>>['buildings'],
  instances: readonly BakeoffInstance[],
  meta: BakeoffApi['instances'],
): void {
  const studioModels: IsoStudioModel[] = instances.map((i) => {
    const support = modelSupport(i.config);
    const r = support.ok
      ? generateStudioMesh(support.config, { baseFootprint: i.source.footprint.coordinates })
      : null;
    const ok = r !== null && r.ok;
    return {
      id: i.source.publicId,
      mesh: ok ? r.mesh : fallbackPrismMesh(i.source),
      colours: { wall: i.config.facade.wallColour, roof: i.config.roof.colour },
      verificationLabel: VERIFICATION_LABELS.unverified,
      appearanceLabel: APPEARANCE_LABEL,
      ...(ok ? {} : { fallback: true }),
    };
  });
  let controller: { flyTo(p: LngLat, zoom?: number): void } | null = null;
  let isoSelected: string | null = null;
  createRoot(root).render(
    createElement(IsoView, {
      data: { buildings, basemap: data.basemap, boundary: data.boundary },
      studioModels,
      theme,
      reducedMotion: true,
      showLabels: true,
      selectedId: null,
      route: null,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      onSelect: (id) => {
        isoSelected = id;
      },
      onReady: (c) => {
        controller = c;
      },
      className: 'absolute inset-0',
    }),
  );
  const frames = () =>
    new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  window.__BAKEOFF__ = {
    renderer: 'iso',
    instances: meta,
    async view(name) {
      const v = VIEWS[name] ?? VIEWS.overview!;
      controller?.flyTo(v.center, v.zoom);
      await frames();
      await frames();
    },
    async orbit() {
      // Gestures are driven by the spec through real pointer events (the overview's cached-bitmap path).
      return { intervals: [], layerMs: [] };
    },
    async pickTarget(index) {
      const i = meta[index];
      if (!i) return null;
      isoSelected = null;
      controller?.flyTo(i.anchor, 17.5);
      await new Promise((r) => setTimeout(r, 400));
      await frames();
      return window.__ATLAS_ISO__?.projectToViewport(i.anchor, i.topM * 0.6) ?? null;
    },
    lastSelected: () => isoSelected,
    sample: () => Promise.resolve([]),
    showDetections: () => Promise.resolve(''),
    loseContext: () => false,
    restoreContext: () => false,
    debug: () => window.__ATLAS_ISO__?.getFrameStats() ?? null,
    idle: frames,
  };
}

main().catch((err: unknown) => {
  window.__BAKEOFF_ERROR__ = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  console.error(err);
});
