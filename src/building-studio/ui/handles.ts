/**
 * Map handles of the Building Studio (S13) and what a handle drag does to a
 * model. Pure: positions in, a new model out, everything in METRES in the
 * local ENU frame (never screen pixels; MapView reports ground positions).
 *
 *  - move   — at the anchor (footprint centre); drags the whole model.
 *  - rotate — ahead of the model's front edge; the drag angle about the
 *             anchor is the rotation change (clockwise positive).
 *  - resize — at the middle of each side (front/back change the length,
 *             left/right the width); the OPPOSITE side stays where it is.
 *
 * A model of an existing base building ('footprint-prism') gets no handles:
 * its mapped footprint is authoritative (S5) and is never moved by a drag.
 */
import type { LngLat } from '../../data/index.ts';
import { createEnuFrame } from '../index.ts';
import { moveByMetres, normalizeRotation, rotateToEnu } from '../editor.ts';
import type { Vec2 } from '../index.ts';
import type { ModelConfigV1 } from '../index.ts';
import type { EditHandle, HandleDragEvent, ResizeAxis } from '../../map/editing/index.ts';

export type ModelSide = 'front' | 'back' | 'left' | 'right';
export const MODEL_SIDES: readonly ModelSide[] = ['front', 'back', 'left', 'right'];

export type HandleSet = 'none' | 'move' | 'rotate' | 'resize' | 'all';

/** Smallest width/length a resize drag produces (numeric fields accept any storable value). */
export const MIN_DRAG_SIZE_M = 1;
/** Distance of the rotate handle beyond the front edge. */
export const ROTATE_HANDLE_GAP_M = 6;

/** Outward unit direction of a side in model-local coordinates (front = +y, right = +x). */
const SIDE_DIR: Readonly<Record<ModelSide, Vec2>> = {
  front: [0, 1],
  back: [0, -1],
  right: [1, 0],
  left: [-1, 0],
};

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** Compass direction (8-way) of an east/north vector, for the resize cursor. */
export function compassAxis(v: Vec2): ResizeAxis {
  const deg = normalizeRotation((Math.atan2(v[0], v[1]) * 180) / Math.PI); // clockwise from north
  const axes: ResizeAxis[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  return axes[Math.round(deg / 45) % 8]!;
}

function sideMidpoint(model: ModelConfigV1, side: ModelSide): Vec2 {
  const d = SIDE_DIR[side];
  return rotateToEnu([(d[0] * model.widthM) / 2, (d[1] * model.lengthM) / 2], model.rotationDeg);
}

/** Handles for a model; `set` picks which (the active tool). */
export function editHandles(model: ModelConfigV1, set: HandleSet): EditHandle[] {
  if (set === 'none' || model.generatorId === 'footprint-prism') return [];
  const frame = createEnuFrame(model.anchor);
  const out: EditHandle[] = [];
  if (set === 'move' || set === 'all')
    out.push({
      id: 'move',
      kind: 'move',
      position: [model.anchor[0], model.anchor[1]],
      label: 'Move the building (or use the move buttons and coordinate fields)',
    });
  if (set === 'rotate' || set === 'all') {
    const p = rotateToEnu([0, model.lengthM / 2 + ROTATE_HANDLE_GAP_M], model.rotationDeg);
    out.push({
      id: 'rotate',
      kind: 'rotate',
      position: frame.toLngLat(p),
      label: 'Rotate the building (or use the rotation field and buttons)',
    });
  }
  if (set === 'resize' || set === 'all')
    for (const side of MODEL_SIDES) {
      const mid = sideMidpoint(model, side);
      out.push({
        id: `resize:${side}`,
        kind: 'resize',
        axis: compassAxis(mid),
        position: frame.toLngLat(mid),
        label: `Resize from the ${side} side (or type the ${side === 'left' || side === 'right' ? 'width' : 'length'})`,
      });
    }
  return out;
}

const isSide = (s: string): s is ModelSide => (MODEL_SIDES as readonly string[]).includes(s);

/**
 * The model after a handle drag from `start` to `current`, applied to the
 * model as it was when the drag began (so every move event recomputes from
 * the same base and nothing accumulates rounding).
 */
export function applyHandleDrag(
  base: ModelConfigV1,
  e: Pick<HandleDragEvent, 'handleId' | 'kind' | 'start' | 'current'>,
): ModelConfigV1 {
  if (base.generatorId === 'footprint-prism') return base;
  const frame = createEnuFrame(base.anchor);
  const s = frame.toLocal(e.start);
  const c = frame.toLocal(e.current);
  if (e.kind === 'move') return moveByMetres(base, round(c[0] - s[0], 3), round(c[1] - s[1], 3));
  if (e.kind === 'rotate') {
    if (Math.hypot(s[0], s[1]) < 0.5 || Math.hypot(c[0], c[1]) < 0.5) return base;
    const a0 = Math.atan2(s[1], s[0]);
    const a1 = Math.atan2(c[1], c[0]);
    // Counter-clockwise screen angle → clockwise-from-north rotation (negated).
    const delta = (-(a1 - a0) * 180) / Math.PI;
    return { ...base, rotationDeg: round(normalizeRotation(base.rotationDeg + delta), 1) };
  }
  if (e.kind === 'resize') {
    const side = e.handleId.startsWith('resize:') ? e.handleId.slice('resize:'.length) : '';
    if (!isSide(side)) return base;
    const u = rotateToEnu(SIDE_DIR[side], base.rotationDeg);
    const along = (c[0] - s[0]) * u[0] + (c[1] - s[1]) * u[1];
    const field = side === 'left' || side === 'right' ? 'widthM' : 'lengthM';
    const size = Math.max(MIN_DRAG_SIZE_M, round(base[field] + along, 1));
    const grow = size - base[field];
    // The opposite side stays put: the centre moves by half the change, outwards.
    const moved = moveByMetres(base, (u[0] * grow) / 2, (u[1] * grow) / 2);
    return { ...moved, [field]: size };
  }
  return base;
}

/** Ground position of the reticle/placement point for typed east/north offsets from a point. */
export function offsetPosition(from: LngLat, eastM: number, northM: number): LngLat {
  return createEnuFrame(from).toLngLat([eastM, northM]);
}
