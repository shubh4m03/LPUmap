/**
 * Map placement for "Suggest a missing place" (src/map/editing contract):
 * while the suggest panel is the open panel and nothing has been submitted,
 *  - desktop: a click puts the point there and its handle can be dragged;
 *  - phones: on the "place" step the centre pin is the placement point.
 * Map clicks never select places meanwhile. Closing the panel (or a
 * successful submission) returns the map to normal.
 */
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useIsMobile } from '../../accessibility/index.ts';
import { useAppStore } from '../../app/store/index.ts';
import type { LngLat } from '../../data/schema.ts';
import type { EditPreviewCollection, MapEditingProps } from '../../map/editing/types.ts';
import { useSuggestStore } from './suggest-store.ts';

const round7 = (v: number) => Math.round(v * 1e7) / 1e7;
export const roundPoint = (p: LngLat): LngLat => [round7(p[0]), round7(p[1])];

export function suggestPreview(point: LngLat | null): EditPreviewCollection {
  return {
    type: 'FeatureCollection',
    features: point
      ? [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [point[0], point[1]] },
            properties: { role: 'point', id: 'suggestion' },
          },
        ]
      : [],
  };
}

export function useSuggestEditing(): MapEditingProps | null {
  const active = useAppStore((s) => s.activePanel === 'suggest');
  const mobile = useIsMobile();
  const { step, point, submitting } = useSuggestStore(
    useShallow((s) => ({ step: s.step, point: s.point, submitting: s.submitting })),
  );

  return useMemo<MapEditingProps | null>(() => {
    if (!active || step === 'submitted') return null;
    const { setPoint, setReticleCenter } = useSuggestStore.getState();
    const reticle = mobile && step === 'place';
    const draggable = !mobile && !submitting && point !== null;
    return {
      input: reticle ? 'reticle' : 'pointer',
      // On the centre-pin step the pin itself is the marker.
      preview: reticle ? null : suggestPreview(point),
      previewModel: null,
      handles:
        draggable && point
          ? [{ id: 'move', kind: 'move', position: point, label: 'Drag to move the suggested place' }]
          : [],
      onPointer(e) {
        if (!mobile && !useSuggestStore.getState().submitting) setPoint(roundPoint(e.lngLat));
      },
      onHandleDrag(e) {
        if (e.phase === 'cancel') setPoint(roundPoint(e.start));
        else if (e.phase !== 'start') setPoint(roundPoint(e.current));
      },
      onReticleChange(center) {
        setReticleCenter(roundPoint(center));
      },
    };
  }, [active, step, mobile, point, submitting]);
}
