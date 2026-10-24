/**
 * The centre pin of mobile placement (`editing.input === 'reticle'`). It is
 * drawn at the centre of the map's PADDED viewport — the point
 * `map.getCenter()` (and so `onReticleChange`) reports — not at the centre
 * of the container: with a bottom sheet open those differ by half the
 * sheet's height, and the pin would point at the wrong ground position.
 */
import type { Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useState } from 'react';

type PaddedMap = Pick<MapLibreMap, 'getPadding' | 'on' | 'off'>;

type Inset = { top: number; bottom: number; left: number; right: number };
const ZERO: Inset = { top: 0, bottom: 0, left: 0, right: 0 };

const sameInset = (a: Inset, b: Inset) =>
  a.top === b.top && a.bottom === b.bottom && a.left === b.left && a.right === b.right;

export function EditReticle({ map }: { map: PaddedMap | null }) {
  const [inset, setInset] = useState<Inset>(ZERO);
  useEffect(() => {
    if (!map) return;
    const update = () => {
      const p = map.getPadding();
      const next = { top: p.top || 0, bottom: p.bottom || 0, left: p.left || 0, right: p.right || 0 };
      setInset((cur) => (sameInset(cur, next) ? cur : next));
    };
    update();
    map.on('move', update);
    map.on('resize', update);
    return () => {
      map.off('move', update);
      map.off('resize', update);
    };
  }, [map]);
  return (
    <div
      aria-hidden="true"
      data-testid="edit-reticle"
      className="pointer-events-none absolute size-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-text shadow-2"
      style={{
        top: `calc(${inset.top}px + (100% - ${inset.top + inset.bottom}px) / 2)`,
        left: `calc(${inset.left}px + (100% - ${inset.left + inset.right}px) / 2)`,
      }}
    >
      <span className="absolute top-1/2 left-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-text" />
    </div>
  );
}
