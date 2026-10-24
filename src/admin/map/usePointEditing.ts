/**
 * Map-editing props for a single-point editor (owner locations, suggestion
 * approval, base-place access points):
 *  - desktop (`pointer`): a click places the point, the handle drags it
 *    (Escape / touchcancel reverts to where the drag began);
 *  - phones (`reticle`): the map centre is the placement point; the editor
 *    shows "Use the map centre" and step buttons instead of dragging.
 * Clicks never select places while this is active.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LngLat } from '../../data/schema.ts';
import type { HandleDragEvent, MapEditingProps } from '../../map/editing/types.ts';
import type { AccessCandidate } from './access-points.ts';
import { pointHandle, pointPreview, roundLngLat } from './preview.ts';

export interface PointEditingOptions {
  point: LngLat | null;
  /** Clicks / drags move the point (false: the map only shows things, clicks go to `onPick`). */
  editable: boolean;
  /** Phones: centre reticle instead of click + drag. */
  reticle: boolean;
  onPoint?(p: LngLat): void;
  /** Click while not editable (e.g. choose a record on the map). */
  onPick?(p: LngLat): void;
  others?: ReadonlyArray<{ id: string; position: LngLat }>;
  candidates?: readonly AccessCandidate[];
  selectedNodeId?: number | null;
  handleLabel?: string;
}

export interface PointEditing {
  editing: MapEditingProps;
  /** Latest map centre in reticle mode (null before the map reported one). */
  reticleCenter: LngLat | null;
}

export function usePointEditing(o: PointEditingOptions): PointEditing {
  const [reticleCenter, setReticleCenter] = useState<LngLat | null>(null);
  const latest = useRef(o);
  useEffect(() => {
    latest.current = o;
  });

  const preview = useMemo(
    () =>
      pointPreview({
        point: o.point,
        others: o.others,
        candidates: o.candidates,
        selectedNodeId: o.selectedNodeId ?? null,
      }),
    [o.point, o.others, o.candidates, o.selectedNodeId],
  );
  const handles = useMemo(
    () => (o.editable && !o.reticle ? pointHandle(o.point, o.handleLabel) : []),
    [o.editable, o.reticle, o.point, o.handleLabel],
  );

  const editing = useMemo<MapEditingProps>(
    () => ({
      input: o.reticle && o.editable ? 'reticle' : 'pointer',
      preview,
      previewModel: null,
      handles,
      onPointer(e) {
        const cur = latest.current;
        if (cur.editable && !cur.reticle) cur.onPoint?.(roundLngLat(e.lngLat));
        else if (!cur.editable) cur.onPick?.(e.lngLat);
      },
      onHandleDrag(e: HandleDragEvent) {
        const cur = latest.current;
        if (!cur.editable) return;
        if (e.phase === 'cancel') cur.onPoint?.(roundLngLat(e.start));
        else if (e.phase !== 'start') cur.onPoint?.(roundLngLat(e.current));
      },
      onReticleChange(center) {
        setReticleCenter(roundLngLat(center));
      },
    }),
    [o.reticle, o.editable, preview, handles],
  );
  return { editing, reticleCenter };
}
