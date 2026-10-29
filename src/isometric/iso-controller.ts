/**
 * IsoController: the overview's camera, implementing the app's MapController
 * contract (docs/ISOMETRIC_AND_3D_DESIGN.md §8.1) so MapControls, focus
 * requests and route framing work unchanged:
 *
 *  - flyTo / fitCoordinates / resetView / zoomIn / zoomOut / setPadding as usual;
 *  - resetNorth restores the default rotation r (the overview rotates in 90° steps);
 *  - follow is a no-op (live GPS is a map-mode feature, §8.2).
 *
 * The view is {center, pxPerMetre, rotation}; the screen transform is derived
 * from it, the viewport size and the padding. Pure state + listeners; the
 * React view animates or jumps (reduced motion) when a change asks for it.
 */
import { APP_CONFIG } from '../config/index.ts';
import type { LngLat } from '../data/index.ts';
import type { MapController, MapPadding } from '../map/index.ts';
import { boxOf, type Pt } from './geometry.ts';
import {
  createIsoProjection,
  defaultRotation,
  pxPerMetreForZoom,
  type IsoRotation,
  type LocalFrame,
  type ScreenTransform,
} from './projection.ts';

export interface IsoView {
  center: LngLat;
  pxPerMetre: number;
  rotation: IsoRotation;
}

export interface IsoViewChange {
  view: IsoView;
  previous: IsoView;
  /** The change may be animated (the view jumps anyway with reduced motion). */
  animate: boolean;
}

export interface IsoController extends MapController {
  getView(): IsoView;
  getTransform(): ScreenTransform;
  /** Screen transform of any view under the current viewport and padding. */
  transformFor(v: IsoView): ScreenTransform;
  getViewport(): { width: number; height: number; padding: MapPadding };
  /** `refit`: pick the default rotation and fit the whole campus (first real size). */
  setViewport(width: number, height: number, opts?: { refit?: boolean }): void;
  /** Smallest allowed scale: slightly below "fit the whole campus". */
  minPxPerMetre(): number;
  setView(v: Partial<IsoView>, opts?: { animate?: boolean }): void;
  panBy(dxPx: number, dyPx: number, opts?: { animate?: boolean }): void;
  /** Zoom by `factor` keeping the ground point under (px, py) fixed. */
  zoomAt(px: number, py: number, factor: number, opts?: { animate?: boolean }): void;
  rotateBy(steps: number): void;
  /** Commits a gesture drawn as `screen' = s · screen + (dx, dy)` over the current bitmap. */
  applyScreenTransform(s: number, dx: number, dy: number): void;
  defaultRotation(): IsoRotation;
  subscribe(listener: (change: IsoViewChange) => void): () => void;
}

export interface IsoControllerOptions {
  frame: LocalFrame;
  /** Campus boundary vertices (local metres): fit, reset, scale floor and default rotation. */
  campusPoints: readonly Pt[];
  width?: number;
  height?: number;
  initial?: Partial<IsoView>;
}

/** Scale used when focusing a place without an explicit zoom. */
export const FOCUS_PX_PER_M = 1.6;
const ZOOM_STEP = 1.6;
const FIT_MARGIN_PX = 24;
const MIN_SCALE_OF_FIT = 0.8;

export function createIsoController(opts: IsoControllerOptions): IsoController {
  const { frame } = opts;
  const maxK = APP_CONFIG.isometric.maxPxPerMetre;
  const [bw, bs, be, bn] = APP_CONFIG.map.maxBounds;
  let width = Math.max(1, opts.width ?? 800);
  let height = Math.max(1, opts.height ?? 600);
  let padding: MapPadding = { top: 0, right: 0, bottom: 0, left: 0 };
  const listeners = new Set<(c: IsoViewChange) => void>();

  const inner = () => ({
    w: Math.max(1, width - padding.left - padding.right),
    h: Math.max(1, height - padding.top - padding.bottom),
    cx: padding.left + Math.max(1, width - padding.left - padding.right) / 2,
    cy: padding.top + Math.max(1, height - padding.top - padding.bottom) / 2,
  });

  const fitScale = (points: readonly Pt[], rotation: IsoRotation, margin = FIT_MARGIN_PX) => {
    const proj = createIsoProjection(rotation);
    const b = boxOf(points.map(([e, n]) => proj.project(e, n, 0) as Pt));
    const { w, h } = inner();
    const sw = b.maxX - b.minX;
    const sh = b.maxY - b.minY;
    const k = Math.min((w - 2 * margin) / Math.max(sw, 1e-6), (h - 2 * margin) / Math.max(sh, 1e-6));
    return { k: Number.isFinite(k) && k > 0 ? k : 1, box: b, proj };
  };
  const pickDefaultRotation = (): IsoRotation => {
    const { w, h } = inner();
    return defaultRotation(opts.campusPoints, w / h);
  };
  const minK = (rotation: IsoRotation) =>
    opts.campusPoints.length >= 3
      ? Math.min(maxK, fitScale(opts.campusPoints, rotation).k * MIN_SCALE_OF_FIT)
      : 0.05;
  const clampK = (k: number, rotation: IsoRotation) => Math.min(maxK, Math.max(minK(rotation), k));
  const clampCenter = (c: LngLat): LngLat => [
    Math.min(be, Math.max(bw, c[0])),
    Math.min(bn, Math.max(bs, c[1])),
  ];

  const campusFit = (rotation: IsoRotation): IsoView => {
    if (opts.campusPoints.length < 3) return { center: APP_CONFIG.map.center, pxPerMetre: 1, rotation };
    const { k, box, proj } = fitScale(opts.campusPoints, rotation);
    const [e, n] = proj.groundAt((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2);
    return { center: frame.toLngLat(e, n), pxPerMetre: Math.min(maxK, k), rotation };
  };

  const r0 = opts.initial?.rotation ?? pickDefaultRotation();
  let view: IsoView = { ...campusFit(r0), ...opts.initial, rotation: r0 };
  view = { ...view, pxPerMetre: clampK(view.pxPerMetre, view.rotation), center: clampCenter(view.center) };

  const transformOf = (v: IsoView): ScreenTransform => {
    const proj = createIsoProjection(v.rotation);
    const [e, n] = frame.toLocal(v.center);
    const [x, y] = proj.project(e, n, 0);
    const { cx, cy } = inner();
    return { k: v.pxPerMetre, tx: cx - v.pxPerMetre * x, ty: cy - v.pxPerMetre * y };
  };
  const centerOf = (t: ScreenTransform, rotation: IsoRotation): LngLat => {
    const proj = createIsoProjection(rotation);
    const { cx, cy } = inner();
    const [e, n] = proj.groundAt((cx - t.tx) / t.k, (cy - t.ty) / t.k);
    return frame.toLngLat(e, n);
  };

  const commit = (next: IsoView, animate: boolean, force = false) => {
    const v: IsoView = {
      rotation: next.rotation,
      pxPerMetre: clampK(next.pxPerMetre, next.rotation),
      center: clampCenter(next.center),
    };
    const previous = view;
    if (
      !force &&
      v.rotation === previous.rotation &&
      v.pxPerMetre === previous.pxPerMetre &&
      v.center[0] === previous.center[0] &&
      v.center[1] === previous.center[1]
    )
      return;
    view = v;
    for (const l of listeners) l({ view: v, previous, animate });
  };

  const zoomAt = (px: number, py: number, factor: number, animate: boolean) => {
    const t = transformOf(view);
    const k = clampK(view.pxPerMetre * factor, view.rotation);
    const s = k / t.k;
    // Keep (px, py) fixed: screen' = s · (screen − p) + p.
    const t2: ScreenTransform = { k, tx: s * (t.tx - px) + px, ty: s * (t.ty - py) + py };
    commit({ ...view, pxPerMetre: k, center: centerOf(t2, view.rotation) }, animate);
  };

  const controller: IsoController = {
    getView: () => view,
    getTransform: () => transformOf(view),
    transformFor: (v) => transformOf(v),
    getViewport: () => ({ width, height, padding }),
    setViewport(w, h, o = {}) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      if (o.refit && !opts.initial) commit(campusFit(pickDefaultRotation()), false, true);
      else commit(view, false, true);
    },
    minPxPerMetre: () => minK(view.rotation),
    setView(v, o = {}) {
      commit({ ...view, ...v }, o.animate ?? false);
    },
    panBy(dx, dy, o = {}) {
      const t = transformOf(view);
      commit(
        { ...view, center: centerOf({ ...t, tx: t.tx - dx, ty: t.ty - dy }, view.rotation) },
        o.animate ?? false,
      );
    },
    zoomAt(px, py, factor, o = {}) {
      zoomAt(px, py, factor, o.animate ?? false);
    },
    rotateBy(steps) {
      const r = ((((view.rotation + steps) % 4) + 4) % 4) as IsoRotation;
      commit({ ...view, rotation: r }, false);
    },
    applyScreenTransform(s, dx, dy) {
      const t = transformOf(view);
      const k = view.pxPerMetre * s;
      const t2: ScreenTransform = { k, tx: s * t.tx + dx, ty: s * t.ty + dy };
      const center = centerOf(t2, view.rotation);
      if (clampK(k, view.rotation) === k) commit({ ...view, pxPerMetre: k, center }, false);
      else {
        // Past a scale limit: keep the pan, clamp the zoom about the viewport centre.
        commit({ ...view, center }, false);
        const { cx, cy } = inner();
        zoomAt(cx, cy, k / view.pxPerMetre, false);
      }
    },
    defaultRotation: pickDefaultRotation,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },

    // --- MapController
    flyTo(lngLat, zoom) {
      const k =
        zoom !== undefined ? pxPerMetreForZoom(zoom, lngLat[1]) : Math.max(view.pxPerMetre, FOCUS_PX_PER_M);
      commit({ ...view, center: lngLat, pxPerMetre: k }, true);
    },
    follow() {
      // Live GPS is not shown in the overview (§8.2).
    },
    fitCoordinates(coords, pad = 48) {
      if (coords.length === 0) return;
      const pts = coords.map((c) => frame.toLocal(c) as Pt);
      if (pts.length === 1) {
        controller.flyTo(coords[0]!);
        return;
      }
      const { k, box, proj } = fitScale(pts, view.rotation, pad);
      const [e, n] = proj.groundAt((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2);
      commit({ ...view, center: frame.toLngLat(e, n), pxPerMetre: k }, true);
    },
    resetView() {
      commit(campusFit(view.rotation), true);
    },
    zoomIn() {
      const { cx, cy } = inner();
      zoomAt(cx, cy, ZOOM_STEP, true);
    },
    zoomOut() {
      const { cx, cy } = inner();
      zoomAt(cx, cy, 1 / ZOOM_STEP, true);
    },
    resetNorth() {
      commit({ ...view, rotation: pickDefaultRotation() }, false);
    },
    setPadding(p) {
      padding = { ...p };
      commit(view, false, true);
    },
  };
  return controller;
}
