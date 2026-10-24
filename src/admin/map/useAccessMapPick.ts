import { useCallback, useMemo, useState } from 'react';
import type { LngLat } from '../../data/schema.ts';
import { candidatesNearClick, type NearClick } from './access-pick.ts';
import type { AccessCandidate } from './access-points.ts';

/** State of "choose the access point on the map" for one point editor. */
export interface AccessMapPick {
  active: boolean;
  /** The last click while picking (null before the first one). */
  click: LngLat | null;
  /** Validated candidates near the click (null before a click). */
  nearby: NearClick<AccessCandidate>[] | null;
  start(): void;
  /** Leaves picking without choosing anything. */
  cancel(): void;
  onMapClick(p: LngLat): void;
}

export function useAccessMapPick(candidates: readonly AccessCandidate[] | null): AccessMapPick {
  const [active, setActive] = useState(false);
  const [click, setClick] = useState<LngLat | null>(null);
  const start = useCallback(() => {
    setClick(null);
    setActive(true);
  }, []);
  const cancel = useCallback(() => {
    setClick(null);
    setActive(false);
  }, []);
  const onMapClick = useCallback((p: LngLat) => setClick([p[0], p[1]]), []);
  const nearby = useMemo(
    () => (active && click ? candidatesNearClick(candidates ?? [], click) : null),
    [active, click, candidates],
  );
  return { active, click: active ? click : null, nearby, start, cancel, onMapClick };
}
