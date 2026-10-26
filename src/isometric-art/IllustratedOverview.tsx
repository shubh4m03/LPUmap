import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { ILLUSTRATION_NOTICE } from './art-ui.ts';
import { installArtTestHooks, type ArtStats } from './art-test-hooks.ts';
import { hitTestHotspots, svgPoints, unionBBox } from './hotspot-geometry.ts';
import { hotspotsOfSubject, type ArtModel } from './hotspot-model.ts';
import { artImageSources, planArtImages, type ArtImageLayer } from './image-plan.ts';
import { artworkUrl } from './manifest-loader.ts';
import { ILLUSTRATION_DISCLAIMER } from './schema.ts';
import {
  clampTransform,
  frameRect,
  gestureTransform,
  initialTransform,
  innerRect,
  interpolateTransform,
  isRectVisible,
  panBy,
  resizeTransform,
  sameTransform,
  scaleLimits,
  screenToSource,
  snapToDevicePixels,
  transformCss,
  visibleSourceRect,
  zoomAbout,
  type ArtInsets,
  type ArtPoint,
  type ArtTransform,
  type ArtViewportSize,
} from './viewport.ts';

/** The overview's camera, registered as the app's MapController (zoom buttons, reset). */
export interface ArtController {
  zoomIn(): void;
  zoomOut(): void;
  resetView(): void;
  /** Frames the outlines of a subject (no-op when it has none). */
  frameSubject(subjectId: string): void;
  getTransform(): ArtTransform;
  // MapController members that have no meaning on an illustration that is not
  // geographically exact: a geographic point is never mapped onto the artwork.
  flyTo(): void;
  follow(): void;
  fitCoordinates(): void;
  resetNorth(): void;
  setPadding(): void;
}

export interface IllustratedOverviewProps {
  model: ArtModel;
  reducedMotion: boolean;
  /** App chrome over the stage (MapPadding). */
  padding: ArtInsets;
  /** Subjects highlighted as selected (the app selection, resolved to subjects). */
  selectedSubjectIds: readonly string[];
  onSelectSubject(subjectId: string | null): void;
  onReady?(controller: ArtController): void;
  /** Called when the artwork image cannot be loaded (the caller falls back to the map-accurate variant). */
  onImageError?(): void;
  /** Top-left controls of the stage (the variant switch). */
  toolbar?: ReactNode;
  /** A status line under the toolbar (e.g. "the selected place is not on the illustration"). */
  notice?: ReactNode;
  /** The detail card of the selected item. */
  card?: ReactNode;
  /** The legend (bottom-left). */
  legend?: ReactNode;
  className?: string;
}

const ANIMATION_MS = 260;
const SETTLE_MS = 140;
const CLICK_SLOP_PX = 6;
/** A fingertip, CSS px: a tap this close to an outline still selects it. */
const TOUCH_TOLERANCE_PX = 12;
const ZOOM_STEP = 1.6;
/** Below this stage width the card sits at the bottom. */
export const NARROW_PX = 640;
/** Width of the floating map controls on a phone (kept clear by the top-left overlays). */
const NARROW_CONTROLS_PX = 96;
/** Height kept free for the bottom row (legend, "Show outlines") below the top-left column. */
const BOTTOM_ROW_PX = 64;
/** Scale a selected item is framed at, at least (so its pin and outline are readable). */
const FRAME_MIN_SCALE = 0.8;

function mark(name: string): void {
  try {
    performance.mark(name);
  } catch {
    // Optional (old browsers, tests).
  }
}

const easeInOut = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);

/**
 * The illustrated overview (owner gate 2): the master artwork as one DOM layer
 * whose single CSS transform (viewport.ts) places BOTH the image files and the
 * SVG hotspot outlines, which are drawn in source pixels. Measured against
 * Canvas2D on the real 3371×2384 master at 4× CPU throttle (Chromium):
 * layered DOM held 16.7 ms frames and ~0.5 s first paint; Canvas2D 33–66 ms
 * frames and ~3.3 s first paint. Pixels are the browser's rendering of the
 * original file: no filter, recolour, stretch or crop.
 */
export function IllustratedOverview(props: IllustratedOverviewProps) {
  const { model, reducedMotion, padding, selectedSubjectIds, onSelectSubject, onReady, onImageError } = props;
  const { space } = model;
  const hintId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  const [size, setSize] = useState<ArtViewportSize>({ width: 0, height: 0 });
  const [dpr, setDpr] = useState(() => (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1));
  /** The live transform (mutated during gestures without re-rendering). */
  const tRef = useRef<ArtTransform | null>(null);
  /** The committed transform (re-plans image files, re-renders overlays). */
  const [view, setView] = useState<ArtTransform | null>(null);
  const sizeRef = useRef(size);
  const insetsRef = useRef<ArtInsets>(padding);
  const dprRef = useRef(dpr);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const animation = useRef<number | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedAt = useRef(0);
  const stats = useRef<ArtStats>({ firstPaintMs: null, baseImageBytes: null, frames: 0, lastFrameWorkMs: 0 });
  const prepared = useMemo(() => model.hotspots.map((h) => h.geometry), [model]);
  const sources = useMemo(() => artImageSources(model.master, space), [model.master, space]);
  const selectedSet = useMemo(() => new Set(selectedSubjectIds), [selectedSubjectIds]);
  const selectedHotspots = useMemo(
    () => model.hotspots.filter((h) => selectedSet.has(h.subjectId)),
    [model, selectedSet],
  );

  // ------------------------------------------------------------ transform

  /** Writes the ONE transform to the shared layer (image files + outlines). */
  const writeTransform = useCallback((t: ArtTransform) => {
    const el = layerRef.current;
    if (!el) return;
    el.style.transform = transformCss(snapToDevicePixels(t, dprRef.current));
  }, []);

  const apply = useCallback(
    (t: ArtTransform) => {
      const t0 = performance.now();
      tRef.current = t;
      writeTransform(t);
      stats.current.frames += 1;
      stats.current.lastFrameWorkMs = performance.now() - t0;
    },
    [writeTransform],
  );

  const commit = useCallback(() => {
    if (tRef.current) setView(tRef.current);
  }, []);

  const clampNow = useCallback(
    (t: ArtTransform) => clampTransform(t, sizeRef.current, space, insetsRef.current),
    [space],
  );

  const stopAnimation = useCallback(() => {
    if (animation.current !== null) {
      cancelAnimationFrame(animation.current);
      animation.current = null;
      commit();
    }
  }, [commit]);

  const animateTo = useCallback(
    (target: ArtTransform) => {
      stopAnimation();
      const from = tRef.current;
      if (!from || reducedMotion || sameTransform(from, target)) {
        apply(target);
        commit();
        return;
      }
      const start = performance.now();
      const vp = sizeRef.current;
      const insets = insetsRef.current;
      // performance.now(), not the rAF timestamp: both clocks must share one origin.
      const step = () => {
        const k = Math.max(0, Math.min(1, (performance.now() - start) / ANIMATION_MS));
        apply(interpolateTransform(from, target, easeInOut(k), vp, insets));
        if (k < 1) animation.current = requestAnimationFrame(step);
        else {
          animation.current = null;
          apply(target);
          commit();
        }
      };
      animation.current = requestAnimationFrame(step);
    },
    [apply, commit, reducedMotion, stopAnimation],
  );

  // Stage size (ResizeObserver) and devicePixelRatio.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      setSize((s) =>
        s.width === r.width && s.height === r.height ? s : { width: r.width, height: r.height },
      );
      setDpr(window.devicePixelRatio || 1);
    };
    read();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read);
    ro?.observe(el);
    window.addEventListener('resize', read);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', read);
    };
  }, []);

  // Size or chrome changes: open on the campus, or keep the centre point (same scale) after a resize.
  const { top: pTop, right: pRight, bottom: pBottom, left: pLeft } = padding;
  useLayoutEffect(() => {
    const dprChanged = dprRef.current !== dpr;
    dprRef.current = dpr;
    if (size.width <= 0 || size.height <= 0) return;
    const insets: ArtInsets = { top: pTop, right: pRight, bottom: pBottom, left: pLeft };
    const oldSize = sizeRef.current;
    const oldInsets = insetsRef.current;
    const t = tRef.current;
    const fresh = t === null || oldSize.width <= 0 || oldSize.height <= 0;
    const changed =
      fresh ||
      oldSize.width !== size.width ||
      oldSize.height !== size.height ||
      oldInsets.top !== insets.top ||
      oldInsets.right !== insets.right ||
      oldInsets.bottom !== insets.bottom ||
      oldInsets.left !== insets.left;
    sizeRef.current = size;
    insetsRef.current = insets;
    if (!changed) {
      // Same geometry; a new devicePixelRatio only changes the pixel snapping.
      if (dprChanged && t) {
        writeTransform(t);
        commit();
      }
      return;
    }
    const next =
      fresh || t === null
        ? initialTransform(size, space, insets, model.focusRect)
        : resizeTransform(t, oldSize, oldInsets, size, insets, space);
    stopAnimation();
    apply(next);
    commit();
  }, [
    size,
    pTop,
    pRight,
    pBottom,
    pLeft,
    dpr,
    space,
    model.focusRect,
    apply,
    commit,
    stopAnimation,
    writeTransform,
  ]);

  // Every render re-writes the live transform (React never owns the style, so a
  // re-render during a gesture cannot snap the layer back).
  useLayoutEffect(() => {
    if (tRef.current) writeTransform(tRef.current);
  });

  useEffect(
    () => () => {
      if (animation.current !== null) cancelAnimationFrame(animation.current);
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  // ------------------------------------------------------------ controller

  const zoomBy = useCallback(
    (factor: number) => {
      const t = tRef.current;
      if (!t) return;
      const inner = innerRect(sizeRef.current, insetsRef.current);
      const limits = scaleLimits(sizeRef.current, space, insetsRef.current);
      animateTo(
        clampNow(zoomAbout(t, factor, inner.x + inner.width / 2, inner.y + inner.height / 2, limits)),
      );
    },
    [animateTo, clampNow, space],
  );

  const resetView = useCallback(() => {
    if (sizeRef.current.width <= 0) return;
    animateTo(initialTransform(sizeRef.current, space, insetsRef.current, model.focusRect));
  }, [animateTo, model.focusRect, space]);

  const frameSubject = useCallback(
    (subjectId: string) => {
      const t = tRef.current;
      const rect = unionBBox(hotspotsOfSubject(model, subjectId).map((h) => h.geometry));
      if (!t || !rect) return;
      animateTo(
        frameRect(t, sizeRef.current, space, insetsRef.current, rect, Math.max(FRAME_MIN_SCALE, t.scale)),
      );
    },
    [animateTo, model, space],
  );

  const controller = useMemo<ArtController>(
    () => ({
      zoomIn: () => zoomBy(ZOOM_STEP),
      zoomOut: () => zoomBy(1 / ZOOM_STEP),
      resetView,
      frameSubject,
      getTransform: () => tRef.current ?? { scale: 1, tx: 0, ty: 0 },
      flyTo: () => {},
      follow: () => {},
      fitCoordinates: () => {},
      resetNorth: () => {},
      setPadding: () => {},
    }),
    [frameSubject, resetView, zoomBy],
  );

  useEffect(() => {
    onReady?.(controller);
  }, [controller, onReady]);

  // ------------------------------------------------------------ images

  const plan = useMemo(() => {
    if (!view || size.width <= 0) return null;
    return planArtImages(sources, view.scale * dpr, visibleSourceRect(view, size, space));
  }, [dpr, size, sources, space, view]);
  // Nothing until the first view is planned: rendering a fallback here would start downloading
  // the full-size image before the plan picks the (much smaller) preview.
  const baseLayer = plan?.base ?? null;
  const baseBytes = useMemo(() => {
    if (!baseLayer) return null;
    const d = model.master.derived.find((x) => x.url === baseLayer.url);
    return d?.bytes ?? (model.master.original?.url === baseLayer.url ? model.master.original.bytes : null);
  }, [baseLayer, model.master]);
  useEffect(() => {
    stats.current.baseImageBytes = baseBytes;
  }, [baseBytes]);
  useLayoutEffect(() => {
    mountedAt.current = performance.now();
  }, []);

  const onBaseLoad = useCallback(() => {
    if (stats.current.firstPaintMs !== null) return;
    requestAnimationFrame(() => {
      stats.current.firstPaintMs = performance.now() - mountedAt.current;
      mark('art:first-paint');
    });
  }, []);

  // ------------------------------------------------------------ test hooks

  useEffect(
    () =>
      installArtTestHooks({
        getTransform: () => ({ ...(tRef.current ?? { scale: 1, tx: 0, ty: 0 }) }),
        getSpace: () => ({ ...space }),
        getStageRect: () => {
          const r = containerRef.current?.getBoundingClientRect();
          return r
            ? { x: r.left, y: r.top, width: r.width, height: r.height }
            : { x: 0, y: 0, width: 0, height: 0 };
        },
        getHotspotIds: () => model.hotspots.map((h) => h.hotspot.hotspotId),
        getHotspotCentroid: (id) => {
          const g = model.byHotspot.get(id)?.geometry.centroid;
          return g ? { ...g } : null;
        },
        getSelectedSubjectIds: () => [...selectedSubjectIds],
        getImageLayers: () => {
          const el = layerRef.current;
          if (!el) return [];
          return [...el.querySelectorAll<HTMLImageElement>('img[data-art-purpose]')].map((img) => ({
            url: img.getAttribute('src') ?? '',
            purpose: img.dataset.artPurpose as ArtImageLayer['purpose'],
          }));
        },
        getStats: () => ({ ...stats.current }),
      }),
    [model, selectedSubjectIds, space],
  );

  // ------------------------------------------------------------ pointer input

  const pointers = useRef(new Map<number, ArtPoint>());
  const gesture = useRef<{
    base: ArtTransform;
    start: Map<number, ArtPoint>;
    moved: boolean;
    downAt: ArtPoint;
  } | null>(null);

  const localPoint = (e: { clientX: number; clientY: number }): ArtPoint => {
    const r = containerRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const hitAt = useCallback(
    (p: ArtPoint, touch: boolean) => {
      const t = tRef.current;
      if (!t) return null;
      const s = screenToSource(t, p.x, p.y);
      return hitTestHotspots(prepared, s.x, s.y, touch ? TOUCH_TOLERANCE_PX / t.scale : 0);
    },
    [prepared],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    stopAnimation();
    if (settleTimer.current) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
      commit();
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Best effort (synthetic events).
    }
    const p = localPoint(e);
    pointers.current.set(e.pointerId, p);
    const t = tRef.current;
    if (!t) return;
    gesture.current = {
      base: t,
      start: new Map(pointers.current),
      moved: gesture.current?.moved ?? false,
      downAt: gesture.current?.downAt ?? p,
    };
    setHoverId(null);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = localPoint(e);
    if (!pointers.current.has(e.pointerId)) {
      if (e.pointerType === 'mouse') {
        const id = hitAt(p, false)?.hotspotId ?? null;
        setHoverId((h) => (h === id ? h : id));
      }
      return;
    }
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    if (
      !g.moved &&
      pointers.current.size === 1 &&
      Math.hypot(p.x - g.downAt.x, p.y - g.downAt.y) < CLICK_SLOP_PX
    )
      return;
    g.moved = true;
    const ids = [...g.start.keys()].filter((id) => pointers.current.has(id));
    const start = ids.map((id) => g.start.get(id)!);
    const now = ids.map((id) => pointers.current.get(id)!);
    const limits = scaleLimits(sizeRef.current, space, insetsRef.current);
    apply(clampNow(gestureTransform(g.base, start, now, limits)));
  };

  const endPointer = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (!g) return;
    if (pointers.current.size > 0) {
      // Re-base on the remaining pointer(s) so the artwork does not jump.
      gesture.current = { ...g, base: tRef.current ?? g.base, start: new Map(pointers.current) };
      return;
    }
    gesture.current = null;
    if (!g.moved && !cancelled) {
      const hit = hitAt(localPoint(e), e.pointerType !== 'mouse');
      onSelectSubject(hit ? hit.subjectId : null);
      return;
    }
    commit();
  };

  // Wheel / trackpad zoom about the cursor; committed after SETTLE_MS idle.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const t = tRef.current;
      if (!t || pointers.current.size > 0) return;
      stopAnimation();
      const r = el.getBoundingClientRect();
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      const limits = scaleLimits(sizeRef.current, space, insetsRef.current);
      apply(clampNow(zoomAbout(t, Math.exp(-delta * 0.002), e.clientX - r.left, e.clientY - r.top, limits)));
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => {
        settleTimer.current = null;
        commit();
      }, SETTLE_MS);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [apply, clampNow, commit, space, stopAnimation]);

  // A tap selects on pointerup, and the detail card can open right under the finger. The
  // browser then hit-tests again for the click it synthesizes from the touch, so that click
  // landed on the new card (e.g. its Close button) and undid the selection. The stage handles
  // touches through pointer events only, so the synthesized mouse events and click are cancelled.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onTouchEnd = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
    };
    el.addEventListener('touchend', onTouchEnd, { passive: false });
    return () => el.removeEventListener('touchend', onTouchEnd);
  }, []);

  // Focus moving into an overflow-hidden box makes the browser scroll it, which
  // would shift the layer outside the transform: undo that, the focus handler pans instead.
  const onScroll = () => {
    const el = containerRef.current;
    if (el && (el.scrollLeft !== 0 || el.scrollTop !== 0)) {
      el.scrollLeft = 0;
      el.scrollTop = 0;
    }
  };

  // ------------------------------------------------------------ keyboard

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const t = tRef.current;
    if (!t) return;
    const inner = innerRect(sizeRef.current, insetsRef.current);
    const step = Math.max(40, Math.min(inner.width, inner.height) * 0.2);
    switch (e.key) {
      case 'ArrowLeft':
        animateTo(clampNow(panBy(t, step, 0)));
        break;
      case 'ArrowRight':
        animateTo(clampNow(panBy(t, -step, 0)));
        break;
      case 'ArrowUp':
        animateTo(clampNow(panBy(t, 0, step)));
        break;
      case 'ArrowDown':
        animateTo(clampNow(panBy(t, 0, -step)));
        break;
      case '+':
      case '=':
        zoomBy(ZOOM_STEP);
        break;
      case '-':
      case '_':
        zoomBy(1 / ZOOM_STEP);
        break;
      case '0':
        resetView();
        break;
      case 'Escape':
        if (selectedSubjectIds.length === 0) return;
        onSelectSubject(null);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const onHotspotKeyDown = (e: ReactKeyboardEvent<SVGPolygonElement>, subjectId: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      onSelectSubject(subjectId);
    }
  };

  const onHotspotFocus = (hotspotId: string) => {
    const h = model.byHotspot.get(hotspotId);
    const t = tRef.current;
    if (!h || !t) return;
    onScroll();
    if (!isRectVisible(t, sizeRef.current, insetsRef.current, h.geometry.bbox))
      animateTo(frameRect(t, sizeRef.current, space, insetsRef.current, h.geometry.bbox, t.scale));
  };

  // ------------------------------------------------------------ keep the selection in sight

  // A new selection that the detail card (bottom on phones, left on wider screens) or the edge
  // of the stage would hide is panned into the free part of the stage (same scale).
  const cardRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const selectionKey = selectedSubjectIds.join('|');
  const hasCard = props.card != null;
  useEffect(() => {
    if (!tRef.current) return;
    if (selectionKey === '') {
      // Selection cleared: undo any room made beside the card (no empty band stays on screen).
      const t = tRef.current;
      const clamped = clampNow(t);
      if (!sameTransform(clamped, t)) animateTo(clamped);
      return;
    }
    const raf = requestAnimationFrame(() => {
      const t = tRef.current;
      const rect = unionBBox(selectedHotspots.map((h) => h.geometry));
      const stage = containerRef.current?.getBoundingClientRect();
      if (!t || !rect || !stage) return;
      const insets: ArtInsets = { ...insetsRef.current };
      // The variant switch and the notice cover the top-left corner of the stage.
      const head = headRef.current?.getBoundingClientRect();
      if (head && head.height > 0) insets.top = Math.max(insets.top, head.bottom - stage.top + 8);
      const card = cardRef.current?.getBoundingClientRect();
      if (card && card.height > 0) {
        if (sizeRef.current.width < NARROW_PX)
          insets.bottom = Math.max(insets.bottom, stage.bottom - card.top + 8);
        else insets.left = Math.max(insets.left, card.right - stage.left + 8);
      }
      if (!isRectVisible(t, sizeRef.current, insets, rect))
        animateTo(frameRect(t, sizeRef.current, space, insets, rect, t.scale));
    });
    return () => cancelAnimationFrame(raf);
    // Only when the selection (or whether a card is shown) changes, not on every pan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, hasCard]);

  // ------------------------------------------------------------ render

  const narrow = size.width > 0 && size.width < NARROW_PX;
  const selectedNames = selectedHotspots.map((h) => h.name);
  const label =
    `Illustrated campus overview with ${model.hotspots.length} clickable outlines.` +
    (selectedNames.length > 0 ? ` Selected: ${[...new Set(selectedNames)].join('; ')}.` : '');

  const imageEl = (l: ArtImageLayer, base: boolean) => (
    <img
      key={l.key}
      src={artworkUrl(l.url)}
      alt=""
      draggable={false}
      decoding="async"
      {...(base ? { fetchPriority: 'high' as const } : {})}
      data-art-purpose={l.purpose}
      className="absolute max-w-none select-none"
      style={{ left: l.x, top: l.y, width: l.width, height: l.height }}
      onLoad={base ? onBaseLoad : undefined}
      onError={base ? onImageError : undefined}
    />
  );

  return (
    <div
      className={`relative h-full w-full overflow-hidden select-none ${className(props.className)}`}
      data-testid="art-view"
      style={{ background: 'var(--ds-surface-sunken)' }}
    >
      <style>{HOTSPOT_CSS}</style>
      <div
        ref={containerRef}
        role="group"
        aria-label={label}
        aria-describedby={hintId}
        tabIndex={0}
        className={`absolute inset-0 cursor-grab touch-none overflow-hidden outline-none focus-visible:shadow-[inset_0_0_0_3px_var(--ds-focus-ring)] active:cursor-grabbing ${showAll ? 'art-show-all' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endPointer(e, false)}
        onPointerCancel={(e) => endPointer(e, true)}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') setHoverId(null);
        }}
        onKeyDown={onKeyDown}
        onScroll={onScroll}
        data-testid="art-stage"
      >
        {/* ONE layer, ONE transform: image files and outlines in source pixels. */}
        <div
          ref={layerRef}
          className="absolute top-0 left-0 origin-top-left"
          style={{ width: space.width, height: space.height }}
          data-testid="art-layer"
        >
          {baseLayer ? imageEl(baseLayer, true) : null}
          {plan?.detail.map((l) => imageEl(l, false))}
          <svg
            className="pointer-events-none absolute top-0 left-0 overflow-visible"
            width={space.width}
            height={space.height}
            viewBox={`0 0 ${space.width} ${space.height}`}
            role="group"
            aria-label="Outlines on the illustration"
            data-testid="art-outlines"
          >
            {model.hotspots.map((h) => {
              const id = h.hotspot.hotspotId;
              const selected = selectedSet.has(h.subjectId);
              return (
                <polygon
                  key={id}
                  points={svgPoints(h.geometry.ring)}
                  role="button"
                  tabIndex={0}
                  aria-label={h.name}
                  aria-pressed={selected}
                  className={`art-hs${h.needsReview ? ' needs-review' : ''}${hoverId === id ? ' is-hover' : ''}`}
                  data-hotspot-id={id}
                  data-subject-id={h.subjectId}
                  onKeyDown={(e) => onHotspotKeyDown(e, h.subjectId)}
                  onFocus={() => onHotspotFocus(id)}
                />
              );
            })}
            <g aria-hidden="true" data-testid="art-selection">
              {selectedHotspots.map((h) => (
                <g key={h.hotspot.hotspotId} data-selected-hotspot-id={h.hotspot.hotspotId}>
                  <polygon className="art-sel-halo" points={svgPoints(h.geometry.ring)} />
                  <polygon className="art-sel" points={svgPoints(h.geometry.ring)} />
                </g>
              ))}
            </g>
          </svg>
        </div>
      </div>
      <p id={hintId} className="sr-only">
        {ILLUSTRATION_DISCLAIMER} Tab moves through the outlines, Enter selects. Arrow keys pan, plus and
        minus zoom, 0 shows the whole campus, Escape clears the selection.
      </p>

      <div
        className="pointer-events-none absolute flex flex-col items-start gap-2"
        style={{
          top: padding.top + 12,
          left: padding.left + 12,
          // Phones: keep clear of the floating map controls on the right.
          right: padding.right + (narrow ? NARROW_CONTROLS_PX : 12),
          // Leaves room for the legend row at the bottom.
          maxHeight: `calc(100% - ${padding.top + padding.bottom + 24 + BOTTOM_ROW_PX}px)`,
        }}
      >
        <div ref={headRef} className="flex flex-col items-start gap-2">
          {props.toolbar}
          <p
            className="pointer-events-auto rounded-md border border-border bg-surface-raised px-2 py-1 text-xs font-medium text-text shadow-1"
            data-testid="art-notice"
            title={ILLUSTRATION_DISCLAIMER}
          >
            {ILLUSTRATION_NOTICE}
          </p>
          {props.notice}
        </div>
        {props.card && !narrow ? (
          <div ref={cardRef} className="flex min-h-0 w-full max-w-sm flex-col">
            {props.card}
          </div>
        ) : null}
      </div>

      <div
        className="pointer-events-none absolute flex flex-col items-start gap-2"
        style={{
          bottom: padding.bottom + 12,
          left: padding.left + 12,
          right: padding.right + 12,
          maxHeight: narrow ? '55%' : undefined,
        }}
      >
        {props.card && narrow ? (
          <div ref={cardRef} className="flex min-h-0 w-full flex-col">
            {props.card}
          </div>
        ) : null}
        <div className="flex flex-wrap items-end gap-2">
          {props.legend}
          <label className="pointer-events-auto flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text shadow-2">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
              data-testid="art-show-outlines"
            />
            Show outlines
          </label>
        </div>
      </div>
    </div>
  );
}

const className = (c: string | undefined) => c ?? '';

/**
 * Outline styles. Colours are fixed (not themed): they sit on the artwork,
 * which keeps its own colours in both themes. Outlines are drawn only on
 * hover, keyboard focus, selection or "Show outlines", and never fill the
 * shape opaquely, so the artwork stays visible under them. Strokes do not
 * scale with zoom (vector-effect).
 */
const HOTSPOT_CSS = `
.art-hs{fill:transparent;stroke:none;vector-effect:non-scaling-stroke;outline:none}
.art-hs.is-hover{stroke:#1d4ed8;stroke-width:2px;fill:rgb(29 78 216 / .08)}
.art-show-all .art-hs{stroke:#1d4ed8;stroke-width:1.5px}
.art-show-all .art-hs.needs-review{stroke:#b45309;stroke-dasharray:5 4}
.art-hs:focus-visible{stroke:#111827;stroke-width:3px;stroke-dasharray:7 4;fill:rgb(255 255 255 / .14)}
.art-sel-halo{fill:none;stroke:#ffffff;stroke-opacity:.95;stroke-width:7px;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.art-sel{fill:rgb(29 78 216 / .1);stroke:#1d4ed8;stroke-width:3px;stroke-linejoin:round;vector-effect:non-scaling-stroke}
`;
