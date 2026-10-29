/**
 * The campus data the Studio map draws: the base dataset with the CURRENT
 * publication applied (overrides, locations, published studio buildings), so
 * the owner edits in the same context the public map shows. The publication
 * is fetched fresh (no saved copy: the Studio must never show stale public
 * data) and re-fetched after publish, archive, restore or delete.
 *
 * The base dataset alone always works; a failing publication only means
 * other published studio buildings are not drawn (reported, never hidden).
 */
import { useCallback, useEffect, useState } from 'react';
import type { StudioRenderModel } from '../../building-studio/index.ts';
import { applyPublication } from '../../app/data/apply-publication.ts';
import { loadPublication } from '../../app/data/publication.ts';
import {
  createOptionalLoaders,
  loadCampusData,
  type CampusData,
  type OptionalDataLoaders,
} from '../../data/index.ts';

export type StudioMapData =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      data: CampusData;
      studioModels: readonly StudioRenderModel[];
      optional: OptionalDataLoaders;
      /** Why other published buildings may be missing, or null. */
      publicationNote: string | null;
    };

async function load(): Promise<Exclude<StudioMapData, { status: 'loading' | 'error' }>> {
  const base = await loadCampusData();
  const optional = createOptionalLoaders(base.manifest);
  const pub = await loadPublication({ store: null });
  const buildings = pub.publication?.buildings ?? [];
  const review = buildings.length > 0 ? await optional.boundaryReview().catch(() => null) : null;
  const applied = applyPublication(base, pub.publication, review);
  const note =
    pub.status.kind === 'live'
      ? applied.studioSkipped > 0
        ? `${applied.studioSkipped} published building(s) are not drawn: the boundary review data could not be loaded.`
        : null
      : pub.status.kind === 'unavailable'
        ? 'This host has no publication API: other published buildings are not drawn.'
        : 'The current publication could not be loaded: other published buildings are not drawn.';
  return {
    status: 'ready',
    data: applied.data,
    studioModels: applied.studioModels,
    optional,
    publicationNote: note,
  };
}

export function useStudioMapData(): StudioMapData & { refresh(): void } {
  const [state, setState] = useState<StudioMapData>({ status: 'loading' });
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let cancelled = false;
    load().then(
      (s) => {
        if (!cancelled) setState(s);
      },
      (err: unknown) => {
        if (cancelled) return;
        setState({
          status: 'error',
          message:
            err instanceof Error && err.message
              ? `The campus data could not be loaded: ${err.message}`
              : 'The campus data could not be loaded.',
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [generation]);
  const refresh = useCallback(() => setGeneration((g) => g + 1), []);
  return { ...state, refresh };
}
