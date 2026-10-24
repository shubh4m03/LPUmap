/**
 * Data for choosing a studio building's access point on the map: the valid
 * candidates of the open draft and the map features drawn while picking.
 */
import { useMemo } from 'react';
import { APP_CONFIG } from '../../config/index.ts';
import { currentDraft } from '../../building-studio/editor-state.ts';
import {
  walkableNodesNearFootprint,
  type FootprintAccessCandidate,
} from '../../building-studio/ui/fields.ts';
import { previewFootprint } from '../../building-studio/ui/preview.ts';
import { useStudio } from '../../building-studio/ui/store.ts';
import type { EditPreviewFeature } from '../../map/editing/types.ts';
import { useStudioServices } from './studio-context.ts';

/**
 * Valid access-point candidates of the open NEW studio building (null when
 * nothing is open, the map data is not loaded, or it models an existing
 * building, whose access point lives in the base-place override).
 */
export function useStudioAccessCandidates(): FootprintAccessCandidate[] | null {
  const { data, store } = useStudioServices();
  const model = useStudio(store, (s) => currentDraft(s.editor)?.model ?? null);
  const targetId = useStudio(store, (s) => s.editor.targetId);
  return useMemo(() => {
    if (!data || !model || targetId) return null;
    const fp = previewFootprint(model, null);
    return fp.ok
      ? walkableNodesNearFootprint(
          data.graph,
          fp.footprint.coordinates,
          APP_CONFIG.routing.maxPlaceConnectorM,
        )
      : null;
  }, [data, model, targetId]);
}

/** Map features while picking: the valid nodes, the chosen one, and the last click. */
export function accessPickFeatures(
  candidates: readonly FootprintAccessCandidate[],
  chosenNodeId: number | null,
  click: readonly [number, number] | null,
): EditPreviewFeature[] {
  const point = (c: readonly [number, number], role: EditPreviewFeature['properties']['role'], id: string) =>
    ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [c[0], c[1]] },
      properties: { role, id },
    }) as EditPreviewFeature;
  const out = candidates.map((c) =>
    point(c.position, c.nodeId === chosenNodeId ? 'snap' : 'path', `node:${c.nodeId}`),
  );
  if (click) out.push(point(click, 'guide', 'pick-click'));
  return out;
}
