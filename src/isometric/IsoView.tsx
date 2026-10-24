import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { announce } from '../accessibility/index.ts';
import { IconButton } from '../components/ui/index.ts';
import { APP_CONFIG } from '../config/index.ts';
import type { CampusData, LngLat } from '../data/index.ts';
import type { MapPadding, MapRouteOverlay } from '../map/types.ts';
import { cappedDpr, drawDynamic, drawStatic, type DrawView, type IsoCtx } from './draw.ts';
import { hitTest } from './hit-test.ts';
import { isoBuildingTitle, topDirection } from './info.ts';
import { IsoInfoCard } from './IsoInfoCard.tsx';
import { createIsoController, type IsoController, type IsoView as IsoViewState } from './iso-controller.ts';
import { ISO_THEME_COLORS, type IsoTheme } from './iso-theme.ts';
import { IsoLegend } from './IsoLegend.tsx';
import type { PlacedLabel } from './labels.ts';
import { createLocalFrame, type ScreenTransform } from './projection.ts';
import { buildGround, buildIsoScene, type IsoStudioModel } from './scene.ts';
import { installIsoTestHooks, type IsoFrameStats } from './test-hooks.ts';

export interface IsoViewProps {
  data: Pick<CampusData, 'buildings' | 'basemap' | 'boundary'>;
  /** Owner-authored models to draw in place of their buildings' prisms (S1). */
  studioModels?: readonly IsoStudioModel[];
  theme: IsoTheme;
  reducedMotion: boolean;
  showLabels: boolean;
  /** Building to highlight (a building place, or the host building of a selected place). */
  selectedId: string | null;
  /** Selected place that is not a building, drawn as a pin. */
  selectedPoint?: LngLat | null;
  route: MapRouteOverlay | null;
  padding: MapPadding;
  onSelect(id: string | null): void;
  /** Click on the ground (no building or marker): an exact ground point. */
  onGroundClick?(lngLat: LngLat): void;
  onReady?(controller: IsoController): void;
  /** `D` key: open the accessible directory. */
  onOpenDirectory?(): void;
  /**
   * Narrow screens show the selected building's info card above the legend. False hides it
   * there (e.g. while a details sheet already shows the same labels and would leave the card
   * covering the centred building). Wide screens always show it. Default true.
   */
  narrowInfoCard?: boolean;
  className?: string;
}

const NO_STUDIO: readonly IsoStudioModel[] = [];
const ANIMATION_MS = 280;
const SETTLE_MS = 120;
const CLICK_SLOP_PX = 6;
/** Below this canvas width the info panel moves to the bottom and shows its essentials only. */
const NARROW_PX = 640;

interface Gesture {
  base: { s: number; dx: number; dy: number };
  start: Map<number, { x: number; y: number }>;
  current: { s: number; dx: number; dy: number };
  moved: boolean;
  wheel: boolean;
}

const identity = { s: 1, dx: 0, dy: 0 };

function mark(name: string): void {
  try {
    performance.mark(name);
  } catch {
    // performance.mark is optional (old browsers, some test environments).
  }
}
function measure(name: string, start: string): void {
  try {
    performance.measure(name, start);
  } catch {
    // Same as above.
  }
}

/**
 * The isometric overview (Decision D4): a Canvas2D renderer of the real campus
 * footprints with its own hit-testing, pan/zoom/keyboard navigation, legend
 * and info panel. Works without WebGL and never imports MapLibre.
 */
export function IsoView(props: IsoViewProps) {
  const {
    data,
    studioModels = NO_STUDIO,
    theme,
    reducedMotion,
    showLabels,
    selectedId,
    selectedPoint = null,
    route,
    padding,
    onSelect,
    onGroundClick,
    onReady,
    onOpenDirectory,
    narrowInfoCard = true,
    className,
  } = props;
  const hintId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const staticRef = useRef<HTMLCanvasElement>(null);
  const dynamicRef = useRef<HTMLCanvasElement>(null);

  const frame = useMemo(() => createLocalFrame(), []);
  const ground = useMemo(
    () => buildGround({ basemap: data.basemap, boundary: data.boundary }, frame),
    [data.basemap, data.boundary, frame],
  );
  const controller = useMemo(
    () => createIsoController({ frame, campusPoints: ground.campusPoints }),
    [frame, ground],
  );
  const [drawnView, setDrawnView] = useState<IsoViewState>(() => controller.getView());
  const [size, setSize] = useState({ width: 0, height: 0 });
  const colors = ISO_THEME_COLORS[theme];

  const stats = useRef<IsoFrameStats>({
    sceneBuildMs: 0,
    fullRedrawMs: 0,
    dynamicRedrawMs: 0,
    hitTestMs: 0,
    cycles: 0,
    faceCycles: 0,
    interleavedPairs: 0,
    buildings: 0,
    faces: 0,
    fullRedraws: 0,
    dynamicRedraws: 0,
  });
  const labelsRef = useRef<PlacedLabel[]>([]);
  const gestureRef = useRef<Gesture | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animation = useRef<{ raf: number; target: IsoViewState } | null>(null);
  const staticKey = useRef<unknown[]>([]);

  const rotation = drawnView.rotation;
  const scene = useMemo(() => {
    mark('iso:scene:start');
    const s = buildIsoScene(
      { buildings: data.buildings, basemap: data.basemap, boundary: data.boundary, studioModels },
      rotation,
      frame,
      ground.campusPoints,
    );
    measure('iso:scene', 'iso:scene:start');
    return s;
  }, [data.buildings, data.basemap, data.boundary, studioModels, rotation, frame, ground]);

  // --- controller wiring
  useEffect(() => {
    onReady?.(controller);
  }, [controller, onReady]);

  const setWrapTransform = useCallback((s: number, dx: number, dy: number) => {
    const el = wrapRef.current;
    if (el)
      el.style.transform = s === 1 && dx === 0 && dy === 0 ? '' : `matrix(${s}, 0, 0, ${s}, ${dx}, ${dy})`;
  }, []);

  const finishAnimation = useCallback(() => {
    const a = animation.current;
    if (!a) return;
    cancelAnimationFrame(a.raf);
    animation.current = null;
    setDrawnView(a.target);
  }, []);

  useEffect(
    () => () => {
      if (animation.current) cancelAnimationFrame(animation.current.raf);
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  // Subscribed in a layout effect declared before the size effect, so the first real viewport refit is seen.
  useLayoutEffect(() => {
    const drawnRef = { current: controller.getView() };
    return controller.subscribe(({ view, animate }) => {
      const from = animation.current?.target ?? drawnRef.current;
      if (animation.current) {
        cancelAnimationFrame(animation.current.raf);
        animation.current = null;
      }
      drawnRef.current = view;
      if (!animate || reducedMotion || view.rotation !== from.rotation || gestureRef.current) {
        setDrawnView(view);
        return;
      }
      // Animate the cached bitmaps with a CSS transform, then redraw once at the target (§6.6).
      const t0 = controller.transformFor(from);
      const t1 = controller.transformFor(view);
      const s = t1.k / t0.k;
      const dx = t1.tx - s * t0.tx;
      const dy = t1.ty - s * t0.ty;
      const startAt = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - startAt) / ANIMATION_MS);
        const e = 1 - (1 - p) ** 3;
        setWrapTransform(1 + (s - 1) * e, dx * e, dy * e);
        if (p < 1 && animation.current) animation.current.raf = requestAnimationFrame(step);
        else {
          animation.current = null;
          setDrawnView(view);
        }
      };
      animation.current = { raf: requestAnimationFrame(step), target: view };
    });
  }, [controller, reducedMotion, setWrapTransform]);

  // --- padding, then size (layout effects, so the first campus fit already avoids panels)
  const { top, right, bottom, left } = padding;
  useLayoutEffect(() => {
    controller.setPadding({ top, right, bottom, left });
  }, [controller, top, right, bottom, left]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let first = true;
    const apply = () => {
      const r = el.getBoundingClientRect();
      const width = Math.max(1, Math.round(r.width));
      const height = Math.max(1, Math.round(r.height));
      // The first real size picks the default rotation and fits the campus (§6.3).
      controller.setViewport(width, height, { refit: first });
      first = false;
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [controller]);

  // --- drawing (layout effect: a committed gesture's CSS transform is cleared in the same frame as the redraw)
  const transform: ScreenTransform | null =
    size.width > 0 && size.height > 0 ? controller.transformFor(drawnView) : null;
  useLayoutEffect(() => {
    if (!transform) return;
    const dpr = cappedDpr(typeof window !== 'undefined' ? window.devicePixelRatio : 1);
    const v: DrawView = { t: transform, dpr, width: size.width, height: size.height };
    const sc = staticRef.current;
    const dc = dynamicRef.current;
    if (!sc || !dc) return;
    const key = [scene, transform.k, transform.tx, transform.ty, size.width, size.height, dpr, colors, route];
    const staticDirty =
      key.length !== staticKey.current.length || key.some((x, i) => !Object.is(x, staticKey.current[i]));
    const t0 = performance.now();
    if (staticDirty) {
      const bw = Math.round(size.width * dpr);
      const bh = Math.round(size.height * dpr);
      for (const c of [sc, dc]) {
        if (c.width !== bw) c.width = bw;
        if (c.height !== bh) c.height = bh;
      }
      const ctx = sc.getContext('2d') as IsoCtx | null;
      if (ctx) {
        mark('iso:draw:start');
        drawStatic(ctx, ground, scene, v, colors, { route, showGrid: true });
        measure('iso:draw', 'iso:draw:start');
      }
      staticKey.current = key;
    }
    const dctx = dc.getContext('2d') as IsoCtx | null;
    if (dctx) {
      labelsRef.current = drawDynamic(dctx, scene, v, colors, {
        selectedId,
        selectedPoint,
        route,
        showLabels,
      });
    }
    const ms = performance.now() - t0;
    const st = stats.current;
    if (staticDirty) {
      st.fullRedrawMs = ms;
      st.fullRedraws++;
    } else {
      st.dynamicRedrawMs = ms;
      st.dynamicRedraws++;
    }
    st.sceneBuildMs = scene.stats.buildMs;
    st.cycles = scene.stats.cycles;
    st.faceCycles = scene.stats.faceCycles;
    st.interleavedPairs = scene.stats.interleavedPairs;
    st.buildings = scene.stats.buildings;
    st.faces = scene.stats.faces;
    if (!gestureRef.current && !animation.current) setWrapTransform(1, 0, 0);
  });

  // --- test hooks (?e2e=1)
  const live = useRef({ scene, transform, selectedId, route });
  useLayoutEffect(() => {
    live.current = { scene, transform, selectedId, route };
  });
  useEffect(
    () =>
      installIsoTestHooks({
        getFrameStats: () => ({ ...stats.current }),
        getView: () => controller.getView(),
        getSelectedId: () => live.current.selectedId,
        getRouteCoordinateCount: () => live.current.route?.coordinates.length ?? 0,
        projectToViewport: (lngLat, z = 0) => {
          const { scene: sc, transform: t } = live.current;
          const el = containerRef.current;
          if (!t || !el) return null;
          const [e, n] = sc.frame.toLocal(lngLat);
          const [x, y] = sc.projection.project(e, n, z);
          const r = el.getBoundingClientRect();
          return { x: r.left + t.k * x + t.tx, y: r.top + t.k * y + t.ty };
        },
        getDrawOrder: () => live.current.scene.buildings.map((b) => b.id),
        getKey: (id) => live.current.scene.byId.get(id)?.key ?? null,
        getPlacedLabelIds: () => labelsRef.current.map((l) => l.id),
      }),
    [controller],
  );

  // --- gestures
  const localPoint = (e: { clientX: number; clientY: number }) => {
    const r = containerRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const clampScale = useCallback(
    (s: number) => {
      const k = committedScale(controller);
      const min = controller.minPxPerMetre() / k;
      const max = APP_CONFIG.isometric.maxPxPerMetre / k;
      return Math.min(Math.max(s, min), Math.max(max, min));
    },
    [controller],
  );

  const commitGesture = useCallback(() => {
    const g = gestureRef.current;
    gestureRef.current = null;
    if (!g) return;
    const { s, dx, dy } = g.current;
    if (s === 1 && dx === 0 && dy === 0) {
      setWrapTransform(1, 0, 0);
      return;
    }
    controller.applyScreenTransform(s, dx, dy);
  }, [controller, setWrapTransform]);

  const recompute = (g: Gesture, pts: Map<number, { x: number; y: number }>) => {
    const ids = [...g.start.keys()].filter((id) => pts.has(id));
    let d = identity;
    if (ids.length === 1) {
      const a0 = g.start.get(ids[0]!)!;
      const a1 = pts.get(ids[0]!)!;
      d = { s: 1, dx: a1.x - a0.x, dy: a1.y - a0.y };
    } else if (ids.length >= 2) {
      const a0 = g.start.get(ids[0]!)!;
      const b0 = g.start.get(ids[1]!)!;
      const a1 = pts.get(ids[0]!)!;
      const b1 = pts.get(ids[1]!)!;
      const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y);
      const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
      const s = d0 > 0 ? d1 / d0 : 1;
      const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
      const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
      d = { s, dx: m1.x - s * m0.x, dy: m1.y - s * m0.y };
    }
    const b = g.base;
    const sTotal = clampScale(d.s * b.s);
    const sd = sTotal / b.s;
    g.current = { s: sTotal, dx: sd * b.dx + d.dx, dy: sd * b.dy + d.dy };
    setWrapTransform(g.current.s, g.current.dx, g.current.dy);
  };

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const downAt = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    finishAnimation();
    if (settleTimer.current) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
      commitGesture();
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture is best-effort (synthetic events in tests).
    }
    const p = localPoint(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 1) downAt.current = p;
    const g = gestureRef.current;
    gestureRef.current = {
      base: g ? g.current : identity,
      start: new Map(pointers.current),
      current: g ? g.current : identity,
      moved: g?.moved ?? false,
      wheel: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = localPoint(e);
    pointers.current.set(e.pointerId, p);
    const g = gestureRef.current;
    if (!g) return;
    const d0 = downAt.current;
    if (!g.moved && d0 && Math.hypot(p.x - d0.x, p.y - d0.y) < CLICK_SLOP_PX && pointers.current.size === 1)
      return;
    g.moved = true;
    recompute(g, pointers.current);
  };

  const endPointer = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const g = gestureRef.current;
    if (!g) return;
    if (pointers.current.size > 0) {
      // Re-base on the remaining pointer(s) so the content does not jump.
      gestureRef.current = { ...g, base: g.current, start: new Map(pointers.current) };
      return;
    }
    if (!g.moved && !cancelled) {
      gestureRef.current = null;
      const p = localPoint(e);
      handleClick(p.x, p.y);
      return;
    }
    commitGesture();
  };

  const handleClick = (x: number, y: number) => {
    if (!transform) return;
    const t0 = performance.now();
    const hit = hitTest(scene, transform, labelsRef.current, x, y);
    stats.current.hitTestMs = performance.now() - t0;
    if (hit.kind === 'ground') {
      onGroundClick?.(hit.lngLat);
      onSelect(null);
    } else onSelect(hit.id);
  };

  // Wheel zoom about the cursor: accumulate over the cached bitmap, commit after SETTLE_MS idle.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      finishAnimation();
      const p = localPoint(e);
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      const f = Math.exp(-delta * 0.002);
      const g = gestureRef.current ?? {
        base: identity,
        start: new Map(),
        current: identity,
        moved: true,
        wheel: true,
      };
      if (!g.wheel && pointers.current.size > 0) return; // a drag is in progress
      const sTotal = clampScale(g.current.s * f);
      const s2 = sTotal / g.current.s;
      g.current = { s: sTotal, dx: s2 * (g.current.dx - p.x) + p.x, dy: s2 * (g.current.dy - p.y) + p.y };
      gestureRef.current = g;
      setWrapTransform(g.current.s, g.current.dx, g.current.dy);
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => {
        settleTimer.current = null;
        commitGesture();
      }, SETTLE_MS);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [clampScale, commitGesture, finishAnimation, setWrapTransform]);

  // --- keyboard
  const rotate = (steps: number) => {
    controller.rotateBy(steps);
    announce(`Overview rotated. ${topDirection(controller.getView().rotation).long} is at the top.`);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const step = Math.max(40, Math.min(size.width, size.height) * 0.15);
    const animate = !reducedMotion;
    switch (e.key) {
      case 'ArrowLeft':
        controller.panBy(-step, 0, { animate });
        break;
      case 'ArrowRight':
        controller.panBy(step, 0, { animate });
        break;
      case 'ArrowUp':
        controller.panBy(0, -step, { animate });
        break;
      case 'ArrowDown':
        controller.panBy(0, step, { animate });
        break;
      case '+':
      case '=':
        controller.zoomIn();
        break;
      case '-':
      case '_':
        controller.zoomOut();
        break;
      case '0':
        controller.resetView();
        break;
      case 'r':
        rotate(1);
        break;
      case 'R':
        rotate(-1);
        break;
      case 'd':
      case 'D':
        if (!onOpenDirectory) return;
        onOpenDirectory();
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const selectedBuilding = selectedId ? scene.byId.get(selectedId) : undefined;
  const narrow = size.width > 0 && size.width < NARROW_PX;
  const top_ = topDirection(drawnView.rotation);
  const label =
    `Isometric campus overview: ${scene.buildings.length} mapped campus buildings, ${top_.long} at the top.` +
    (selectedBuilding ? ` Selected: ${isoBuildingTitle(selectedBuilding)}.` : '');

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full overflow-hidden select-none ${className ?? ''}`}
      style={{ background: colors.surroundings }}
      data-testid="iso-view"
    >
      {/* Own compositor layer: a gesture frame only moves the cached bitmaps (no repaint, §6.6). */}
      <div
        ref={wrapRef}
        className="absolute inset-0 origin-top-left will-change-transform"
        aria-hidden="true"
      >
        <canvas ref={staticRef} className="absolute inset-0 h-full w-full" />
        <canvas ref={dynamicRef} className="absolute inset-0 h-full w-full" />
      </div>
      <div
        role="img"
        aria-label={label}
        aria-describedby={hintId}
        tabIndex={0}
        className="absolute inset-0 cursor-grab touch-none outline-none focus-visible:shadow-[inset_0_0_0_3px_var(--ds-focus-ring)] active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endPointer(e, false)}
        onPointerCancel={(e) => endPointer(e, true)}
        onKeyDown={onKeyDown}
      />
      <p id={hintId} className="sr-only">
        Use the Directory for a full list of buildings{onOpenDirectory ? ' (press D)' : ''}. Arrow keys pan,
        plus and minus zoom, R rotates the view, 0 shows the whole campus.
      </p>
      <div
        className="pointer-events-none absolute flex flex-col items-start gap-2"
        // Bounded on the right too, so the info card wraps instead of running under the map controls.
        style={{ top: padding.top + 12, left: padding.left + 12, right: padding.right + 12 }}
      >
        <div
          role="group"
          aria-label="Overview rotation"
          className="pointer-events-auto flex items-center gap-1 rounded-lg border border-border bg-surface-raised p-1 text-sm text-text shadow-2"
        >
          <IconButton icon="chevron-left" label="Rotate view left" size="sm" onClick={() => rotate(-1)} />
          <span className="min-w-14 text-center text-xs font-medium" aria-live="off">
            Top: {top_.short}
          </span>
          <IconButton icon="chevron-right" label="Rotate view right" size="sm" onClick={() => rotate(1)} />
        </div>
        {selectedBuilding && !narrow ? <IsoInfoCard building={selectedBuilding} /> : null}
      </div>
      {/* Narrow screens: the info panel sits at the bottom, so it never covers the focused (centred) building. */}
      <div
        className="pointer-events-none absolute flex flex-col items-start gap-2"
        style={{ bottom: padding.bottom + 12, left: padding.left + 12, right: padding.right + 12 }}
      >
        {selectedBuilding && narrow && narrowInfoCard ? (
          <IsoInfoCard building={selectedBuilding} compact />
        ) : null}
        <IsoLegend colors={colors} hasStudioModels={studioModels.length > 0} />
      </div>
    </div>
  );
}

/** Current scale of the controller (gesture clamping happens against the committed view). */
function committedScale(controller: IsoController): number {
  return controller.getView().pxPerMetre;
}
