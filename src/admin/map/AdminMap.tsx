/**
 * The campus map inside the admin (its own lazy chunk: MapLibre loads only
 * when an admin screen shows a map). Always in editing mode: clicks go to the
 * editor and never select a place (src/map/editing/types.ts). 2D, north up,
 * all layer groups visible so the owner sees every base place.
 */
import { useEffect, useMemo, useState } from 'react';
import { useReducedMotion, useTheme } from '../../accessibility/index.ts';
import '../../app/maplibre-worker.ts';
import { LAYER_GROUPS, type LayerGroupId } from '../../config/categories.ts';
import type { CampusData } from '../../data/campus-data.ts';
import type { LngLat } from '../../data/schema.ts';
import type { MapEditingProps } from '../../map/editing/types.ts';
import { MapView } from '../../map/MapView.tsx';
import type { MapController } from '../../map/types.ts';

export interface AdminMapProps {
  data: CampusData;
  editing: MapEditingProps;
  /** Fly here when it changes (identity); null leaves the camera alone. */
  focus?: { lngLat: LngLat; zoom?: number } | null;
  className?: string;
  onError?(message: string): void;
}

const ALL_GROUPS: ReadonlySet<LayerGroupId> = new Set(LAYER_GROUPS.map((g) => g.id));
const noop = () => {};

export default function AdminMap({ data, editing, focus = null, className, onError }: AdminMapProps) {
  const { resolved } = useTheme();
  const reducedMotion = useReducedMotion();
  const [controller, setController] = useState<MapController | null>(null);
  const groups = useMemo(() => ALL_GROUPS, []);

  useEffect(() => {
    if (controller && focus) controller.flyTo(focus.lngLat, focus.zoom);
  }, [controller, focus]);

  return (
    <MapView
      className={className ?? 'relative h-full w-full'}
      data={data}
      theme={resolved}
      mode3d={false}
      reducedMotion={reducedMotion}
      visibleGroups={groups}
      showLabels
      selectedPlaceId={null}
      route={null}
      userLocation={null}
      onSelectPlace={noop}
      onReady={setController}
      onError={onError}
      editing={editing}
    />
  );
}
