import { useMemo } from 'react';
import type { LngLat } from '../../data/schema.ts';
import type { CampusDataState } from '../data/campus-data.ts';
import { accessCandidates, accessProblem, type AccessCandidate } from './access-points.ts';

export interface AccessCandidatesState {
  /** null while the dataset loads / when it failed. */
  candidates: AccessCandidate[] | null;
  note: string | null;
  /** Server-equivalent verdict for a stored node at `location` (null = valid or unknown). */
  problemFor(nodeId: number): string | null;
}

export function useAccessCandidates(campus: CampusDataState, location: LngLat | null): AccessCandidatesState {
  const graph = campus.status === 'ready' ? campus.data.graph : null;
  const lon = location?.[0];
  const lat = location?.[1];
  return useMemo(() => {
    const at: LngLat | null = lon === undefined || lat === undefined ? null : [lon, lat];
    if (!graph) {
      return {
        candidates: null,
        note:
          campus.status === 'error'
            ? 'Path nodes are unavailable because the campus dataset could not be loaded. You can still save without an access point.'
            : null,
        problemFor: () => null,
      };
    }
    return {
      candidates: at ? accessCandidates(graph, at) : [],
      note: null,
      problemFor: (nodeId: number) => (at ? accessProblem(graph, nodeId, at) : null),
    };
  }, [graph, lon, lat, campus.status]);
}
