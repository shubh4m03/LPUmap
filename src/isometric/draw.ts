/**
 * Canvas2D drawing of the overview (docs/ISOMETRIC_AND_3D_DESIGN.md §6.6).
 *
 *  - Static layer: surroundings, campus ground, basemap, map-key grid, the
 *    route on the ground, then every prism / studio model back to front.
 *    Redrawn only when the scene, view, size, theme or route changes; gestures
 *    move the cached bitmap with a CSS transform instead.
 *  - Dynamic layer: selection, the route seen through buildings (dashed),
 *    route endpoints, map-key markers and labels.
 *
 * Ground is drawn in local metres through an affine canvas transform (true
 * metre widths, exact foreshortening); buildings in view units.
 */
import { APP_CONFIG } from '../config/index.ts';
import type { BasemapLayer, LngLat } from '../data/index.ts';
import type { MapRouteOverlay } from '../map/index.ts';
import type { IsoFace } from './faces.ts';
import type { Box, Pt } from './geometry.ts';
import type { IsoThemeColors } from './iso-theme.ts';
import { DIAMOND_R, LABEL_FONT_PX, placeLabels, type LabelCandidate, type PlacedLabel } from './labels.ts';
import type { ScreenTransform } from './projection.ts';
import type { IsoGround, IsoScene } from './scene.ts';

/** The subset of CanvasRenderingContext2D the overview uses (tests pass a recorder). */
export type IsoCtx = Pick<
  CanvasRenderingContext2D,
  | 'save'
  | 'restore'
  | 'setTransform'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'closePath'
  | 'fill'
  | 'stroke'
  | 'fillRect'
  | 'clearRect'
  | 'setLineDash'
  | 'arc'
  | 'fillText'
  | 'strokeText'
  | 'measureText'
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'globalAlpha'
  | 'font'
  | 'textBaseline'
  | 'textAlign'
  | 'lineJoin'
  | 'lineCap'
>;

export interface DrawView {
  t: ScreenTransform;
  /** Device-pixel ratio actually used for the backing store (capped). */
  dpr: number;
  /** CSS px. */
  width: number;
  height: number;
}

/** Label widths at LABEL_FONT (labels are re-placed on every dynamic redraw; measuring is the costly part). */
const textWidths = new Map<string, number>();

export const LABEL_FONT = `600 ${LABEL_FONT_PX}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
/** Below this scale (CSS px per metre) synthetic windows are not drawn. */
export const WINDOW_MIN_PX_PER_M = 1.2;
/** Map-key grid labels are drawn from this scale up. */
const GRID_LABEL_MIN_PX_PER_M = 0.45;

const ROAD_WIDTH_M: Partial<Record<BasemapLayer, number>> = {
  'road-major': 9,
  road: 6,
  service: 3.5,
  path: 1.4,
  steps: 2,
};

const ringPath = (ctx: IsoCtx, ring: readonly Pt[]) => {
  const first = ring[0];
  if (!first) return;
  ctx.moveTo(first[0], first[1]);
  for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i]![0], ring[i]![1]);
  ctx.closePath();
};

const linePath = (ctx: IsoCtx, coords: readonly Pt[]) => {
  const first = coords[0];
  if (!first) return;
  ctx.moveTo(first[0], first[1]);
  for (let i = 1; i < coords.length; i++) ctx.lineTo(coords[i]![0], coords[i]![1]);
};

/** Canvas transform from local metres (e, n) to device pixels. */
export function groundMatrix(
  scene: Pick<IsoScene, 'projection'>,
  v: DrawView,
): [number, number, number, number, number, number] {
  const { cosT, sinT, sinA } = scene.projection;
  const s = v.dpr * v.t.k;
  return [s * cosT, -s * sinA * sinT, -s * sinT, -s * sinA * cosT, v.dpr * v.t.tx, v.dpr * v.t.ty];
}

/** View-unit rectangle covered by the viewport (with a margin), for culling. */
export function visibleViewBox(v: DrawView, marginPx = 32): Box {
  return {
    minX: (-marginPx - v.t.tx) / v.t.k,
    minY: (-marginPx - v.t.ty) / v.t.k,
    maxX: (v.width + marginPx - v.t.tx) / v.t.k,
    maxY: (v.height + marginPx - v.t.ty) / v.t.k,
  };
}

const intersects = (a: Box, b: Box) =>
  a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

export interface StaticDrawOptions {
  route: MapRouteOverlay | null;
  showGrid: boolean;
}

export interface DrawCounts {
  buildingsDrawn: number;
  facesDrawn: number;
}

export function drawStatic(
  ctx: IsoCtx,
  ground: IsoGround,
  scene: IsoScene,
  v: DrawView,
  c: IsoThemeColors,
  opts: StaticDrawOptions,
): DrawCounts {
  const k = v.t.k;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.fillStyle = c.surroundings;
  ctx.fillRect(0, 0, v.width * v.dpr, v.height * v.dpr);

  // --- Ground, in local metres.
  ctx.setTransform(...groundMatrix(scene, v));
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.fillStyle = c.campusGround;
  for (const poly of ground.boundary) {
    ctx.beginPath();
    for (const r of poly) ringPath(ctx, r);
    ctx.fill('evenodd');
  }
  const fills: Partial<Record<BasemapLayer, string>> = {
    landuse: c.landuse,
    green: c.green,
    pitch: c.pitch,
    parking: c.parking,
    water: c.water,
  };
  for (const p of ground.polygons) {
    ctx.fillStyle = fills[p.layer] ?? c.landuse;
    ctx.beginPath();
    for (const r of p.rings) ringPath(ctx, r);
    ctx.fill('evenodd');
  }
  if (opts.showGrid) {
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1 / k;
    ctx.setLineDash([6 / k, 6 / k]);
    ctx.beginPath();
    for (const g of ground.grid.lines) linePath(ctx, [g.from, g.to]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const metres = (w: number, minPx: number) => Math.max(w, minPx / k);
  // One path per layer (a few strokes instead of hundreds). Casings, then bands minor → major
  // (ground.lines is in that order, so junctions merge), then centre dashes.
  const byLayer = new Map<BasemapLayer, Pt[][]>();
  for (const l of ground.lines) {
    const list = byLayer.get(l.layer);
    if (list) list.push(l.coords);
    else byLayer.set(l.layer, [l.coords]);
  }
  const strokeLayer = (layer: BasemapLayer) => {
    ctx.beginPath();
    for (const coords of byLayer.get(layer) ?? []) linePath(ctx, coords);
    ctx.stroke();
  };
  const roads: BasemapLayer[] = ['road', 'road-major'];
  ctx.strokeStyle = c.roadCasing;
  for (const layer of roads) {
    ctx.lineWidth = metres((ROAD_WIDTH_M[layer] ?? 6) + 1.2, 2);
    strokeLayer(layer);
  }
  for (const layer of byLayer.keys()) {
    const w = ROAD_WIDTH_M[layer] ?? 2;
    if (layer === 'path' || layer === 'steps') {
      ctx.strokeStyle = layer === 'path' ? c.path : c.steps;
      ctx.lineWidth = metres(w, 1.25);
      ctx.setLineDash((layer === 'path' ? [3, 2] : [0.7, 0.7]).map((d) => metres(d, 2)));
    } else {
      ctx.strokeStyle = layer === 'service' ? c.service : c.roadBand;
      ctx.lineWidth = metres(w, 1.5);
      ctx.setLineDash([]);
    }
    strokeLayer(layer);
  }
  ctx.setLineDash([]);
  if (k >= 1.5) {
    ctx.strokeStyle = c.roadDash;
    ctx.lineWidth = 0.35;
    ctx.setLineDash([3, 4]);
    for (const layer of roads) strokeLayer(layer);
    ctx.setLineDash([]);
  }
  ctx.strokeStyle = c.campusOutline;
  ctx.lineWidth = metres(1, 1.5);
  ctx.setLineDash([metres(6, 6), metres(4, 4)]);
  for (const poly of ground.boundary) {
    ctx.beginPath();
    for (const r of poly) ringPath(ctx, r);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // The active route on the ground: buildings in front of it cover it (the dynamic layer re-draws it dashed).
  if (opts.route && opts.route.coordinates.length > 1) {
    const coords = opts.route.coordinates.map((p) => ground.frame.toLocal(p) as Pt);
    ctx.beginPath();
    linePath(ctx, coords);
    ctx.strokeStyle = c.routeCasing;
    ctx.lineWidth = metres(7, 7);
    ctx.stroke();
    ctx.strokeStyle = c.route;
    ctx.lineWidth = metres(4, 4);
    ctx.stroke();
  }

  if (opts.showGrid) drawGridLabels(ctx, ground, scene, v, c);

  // --- Buildings, in view units.
  const s = v.dpr * k;
  ctx.setTransform(s, 0, 0, s, v.dpr * v.t.tx, v.dpr * v.t.ty);
  const visible = visibleViewBox(v);
  const showWindows = k >= WINDOW_MIN_PX_PER_M;
  let facesDrawn = 0;
  ctx.lineJoin = 'miter'; // cheaper than round joins for thousands of thin face edges
  const drawn = new Set<string>();
  for (const { building: b, faces } of scene.draw) {
    if (!intersects(b.box, visible)) continue;
    drawn.add(b.id);
    const tones = b.placeholder ? c.placeholder : c.building;
    let roof = false;
    for (const f of faces) {
      facesDrawn++;
      if (f.material === 'roof') roof = true;
      drawFace(ctx, f, f.fill ?? tones[f.tone], tones.edge, k);
      if (showWindows && f.windows.length > 0) {
        ctx.fillStyle = c.glass;
        ctx.beginPath();
        for (const w of f.windows) ringPath(ctx, w.quad);
        ctx.fill();
      }
    }
    if (roof && b.placeholder && !b.studio) {
      ctx.strokeStyle = tones.edge;
      ctx.lineWidth = 1.25 / k;
      ctx.setLineDash([4 / k, 3 / k]);
      ctx.beginPath();
      for (const r of b.roofOutline) ringPath(ctx, r);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  const buildingsDrawn = drawn.size;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { buildingsDrawn, facesDrawn };
}

function drawFace(ctx: IsoCtx, f: IsoFace, fill: string, edge: string, k: number): void {
  ctx.beginPath();
  ringPath(ctx, f.ring);
  for (const h of f.holes) ringPath(ctx, h);
  ctx.fillStyle = fill;
  ctx.fill('evenodd');
  ctx.strokeStyle = edge;
  ctx.lineWidth = 0.75 / k;
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Dynamic layer
// ---------------------------------------------------------------------------

export interface RouteEndpoints {
  start: LngLat | null;
  end: LngLat | null;
}

export function routeEndpoints(route: MapRouteOverlay | null): RouteEndpoints {
  const coords = route?.coordinates ?? [];
  return { start: coords[0] ?? null, end: coords.length > 1 ? (coords[coords.length - 1] ?? null) : null };
}

/** Screen position (CSS px) of a ground point. */
export function groundToScreen(scene: IsoScene, t: ScreenTransform, p: LngLat): [number, number] {
  const [e, n] = scene.frame.toLocal(p);
  const [x, y] = scene.projection.project(e, n, 0);
  return [t.k * x + t.tx, t.k * y + t.ty];
}

/** Label candidates (CSS px) for the current view. */
export function labelCandidates(
  scene: IsoScene,
  v: DrawView,
  opts: { selectedId: string | null; showLabels: boolean; endpoints: RouteEndpoints },
): LabelCandidate[] {
  const out: LabelCandidate[] = [];
  const vis = visibleViewBox(v, 0);
  for (const b of scene.buildings) {
    const selected = b.id === opts.selectedId;
    if (!opts.showLabels && !selected) continue;
    const text = b.name ?? b.key ?? '';
    if (text === '') continue; // Never "Unnamed building" on the map.
    const [ax, ay] = b.labelAnchor;
    if (!selected && (ax < vis.minX || ax > vis.maxX || ay < vis.minY || ay > vis.maxY)) continue;
    out.push({
      id: b.id,
      kind: selected ? 'selected' : b.name !== null ? 'named' : 'key',
      text,
      x: v.t.k * ax + v.t.tx,
      y: v.t.k * ay + v.t.ty,
      diamond: b.key !== null,
      area: b.areaM2,
    });
  }
  const ends: [string, LngLat | null, string][] = [
    ['endpoint:start', opts.endpoints.start, 'Start'],
    ['endpoint:end', opts.endpoints.end, 'Destination'],
  ];
  for (const [id, p, text] of ends) {
    if (!p) continue;
    const [x, y] = groundToScreen(scene, v.t, p);
    out.push({ id, kind: 'endpoint', text, x: x + 12, y: y - 16, diamond: false, area: 0 });
  }
  return out;
}

export interface DynamicDrawOptions {
  selectedId: string | null;
  /** A selected place that is not a building (gate, facility): drawn as a pin. */
  selectedPoint: LngLat | null;
  route: MapRouteOverlay | null;
  showLabels: boolean;
}

export function drawDynamic(
  ctx: IsoCtx,
  scene: IsoScene,
  v: DrawView,
  c: IsoThemeColors,
  opts: DynamicDrawOptions,
): PlacedLabel[] {
  const k = v.t.k;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, v.width * v.dpr, v.height * v.dpr);
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const toView = (p: LngLat): Pt => {
    const [e, n] = scene.frame.toLocal(p);
    return scene.projection.project(e, n, 0);
  };

  // Route in view units (the projection is affine, so a ground polyline stays a polyline).
  ctx.setTransform(v.dpr * k, 0, 0, v.dpr * k, v.dpr * v.t.tx, v.dpr * v.t.ty);
  const route = opts.route;
  if (route) {
    for (const alt of route.alternatives ?? []) {
      if (alt.length < 2) continue;
      ctx.beginPath();
      linePath(ctx, alt.map(toView));
      ctx.strokeStyle = c.routeAlt;
      ctx.lineWidth = 3 / k;
      ctx.setLineDash([6 / k, 5 / k]);
      ctx.globalAlpha = 0.85;
      ctx.stroke();
    }
    if (route.completed && route.completed.length > 1) {
      ctx.beginPath();
      linePath(ctx, route.completed.map(toView));
      ctx.strokeStyle = c.routeCompleted;
      ctx.lineWidth = 3 / k;
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.stroke();
    }
    if (route.coordinates.length > 1) {
      // Legibility choice (§6.6): the route stays visible behind tall blocks as a dashed line.
      ctx.beginPath();
      linePath(ctx, route.coordinates.map(toView));
      ctx.strokeStyle = c.route;
      ctx.lineWidth = 2.5 / k;
      ctx.setLineDash([5 / k, 4 / k]);
      ctx.globalAlpha = 0.6;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }

  // Selection: a light tint over its visible faces and a thick roof outline with a halo (colour is
  // never the only cue). Only the roof outline is stroked, so a concave building does not turn into a
  // wireframe of its inner walls.
  const sel = opts.selectedId ? scene.byId.get(opts.selectedId) : undefined;
  if (sel) {
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = c.selectedRoof;
    for (const f of sel.faces) {
      ctx.beginPath();
      ringPath(ctx, f.ring);
      for (const h of f.holes) ringPath(ctx, h);
      ctx.fill('evenodd');
    }
    ctx.globalAlpha = 1;
    for (const [style, width] of [
      [c.selectedHalo, 6],
      [c.selected, 3],
    ] as const) {
      ctx.strokeStyle = style;
      ctx.lineWidth = width / k;
      ctx.beginPath();
      for (const r of sel.roofOutline) ringPath(ctx, r);
      ctx.stroke();
    }
  }
  ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);

  // Pin for a selected non-building place.
  if (!sel && opts.selectedPoint) {
    const [x, y] = groundToScreen(scene, v.t, opts.selectedPoint);
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fillStyle = c.selectedHalo;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = c.selected;
    ctx.fill();
  }

  // Route endpoints: filled circles.
  const ends = routeEndpoints(route);
  for (const p of [ends.start, ends.end]) {
    if (!p) continue;
    const [x, y] = groundToScreen(scene, v.t, p);
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fillStyle = c.routeCasing;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = c.endpointFill;
    ctx.fill();
  }

  // Markers and labels.
  ctx.font = LABEL_FONT;
  const placed = placeLabels(
    labelCandidates(scene, v, { selectedId: opts.selectedId, showLabels: opts.showLabels, endpoints: ends }),
    (text) => {
      let w = textWidths.get(text);
      if (w === undefined) {
        w = ctx.measureText(text).width;
        if (textWidths.size > 2000) textWidths.clear();
        textWidths.set(text, w);
      }
      return w;
    },
    { width: v.width, height: v.height },
  );
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const l of placed) {
    if (l.diamond) {
      ctx.beginPath();
      ctx.moveTo(l.x, l.y - DIAMOND_R);
      ctx.lineTo(l.x + DIAMOND_R, l.y);
      ctx.lineTo(l.x, l.y + DIAMOND_R);
      ctx.lineTo(l.x - DIAMOND_R, l.y);
      ctx.closePath();
      ctx.fillStyle = l.kind === 'selected' ? c.selected : c.keyMarkerFill;
      ctx.fill();
      ctx.strokeStyle = l.kind === 'selected' ? c.selectedHalo : c.keyMarkerStroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    if (l.text) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = c.labelHalo;
      ctx.strokeText(l.text, l.textX, l.textY);
      ctx.fillStyle = l.kind === 'key' ? c.keyMarkerText : c.labelText;
      ctx.fillText(l.text, l.textX, l.textY);
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return placed;
}

/** Map-key grid cell names on the ground (a light reference, as street atlases draw). Returns the count drawn. */
export function drawGridLabels(
  ctx: IsoCtx,
  ground: IsoGround,
  scene: IsoScene,
  v: DrawView,
  c: IsoThemeColors,
): number {
  if (v.t.k < GRID_LABEL_MIN_PX_PER_M) return 0;
  ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
  ctx.font = `600 ${LABEL_FONT_PX}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  let n = 0;
  for (const l of ground.grid.labels) {
    const [x, y] = scene.projection.project(l.at[0], l.at[1], 0);
    const sx = v.t.k * x + v.t.tx;
    const sy = v.t.k * y + v.t.ty;
    if (sx < -20 || sy < -20 || sx > v.width + 20 || sy > v.height + 20) continue;
    ctx.lineWidth = 3;
    ctx.strokeStyle = c.campusGround;
    ctx.strokeText(l.text, sx, sy);
    ctx.fillStyle = c.gridText;
    ctx.fillText(l.text, sx, sy);
    n++;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return n;
}

/** Device-pixel ratio for the backing store (capped, §6.6 / §9.3). */
export const cappedDpr = (devicePixelRatio: number | undefined): number =>
  Math.max(1, Math.min(devicePixelRatio || 1, APP_CONFIG.isometric.dprCap));
