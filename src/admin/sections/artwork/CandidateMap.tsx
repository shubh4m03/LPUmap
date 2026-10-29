/**
 * Candidate footprints of an artwork subject on a small campus map, plus the
 * same choices as a list (the map is pointer-only; the list works with a
 * keyboard and without the map). Candidates are research LEADS
 * (docs/research/block-leads/block-candidates.json, carried by the curated
 * baseline): drawn dashed as unverified guides; the building chosen in the
 * form is drawn solid. Clicking a campus building on the map chooses it —
 * the owner chooses, nothing is snapped or guessed.
 */
import { useMemo } from 'react';
import { Badge } from '../../../components/ui/index.ts';
import { Button } from '../../../components/ui/index.ts';
import type { CandidateFootprint } from '../../../isometric-art/index.ts';
import type { MapEditingProps } from '../../../map/editing/index.ts';
import type { CampusDataState } from '../../data/campus-data.ts';
import { MapPanel } from '../../map/MapPanel.tsx';
import {
  buildingAt,
  campusBuildingIndex,
  candidatePreview,
  type CampusBuildingInfo,
} from './candidate-map.ts';

export function CandidateMap({
  campus,
  candidates,
  selectedId,
  onPick,
  disabled,
}: {
  campus: CampusDataState;
  candidates: readonly CandidateFootprint[];
  selectedId: string | null;
  onPick(buildingId: string): void;
  disabled?: boolean;
}) {
  const index = useMemo(
    () =>
      campus.status === 'ready' ? campusBuildingIndex(campus.data) : new Map<string, CampusBuildingInfo>(),
    [campus],
  );
  const preview = useMemo(
    () => candidatePreview(index, candidates, selectedId),
    [index, candidates, selectedId],
  );
  const editing = useMemo<MapEditingProps>(
    () => ({
      input: 'pointer',
      preview,
      previewModel: null,
      handles: [],
      onPointer: (e) => {
        if (disabled) return;
        const id = buildingAt(index, e.lngLat);
        if (id) onPick(id);
      },
    }),
    [preview, index, onPick, disabled],
  );
  const focusId = selectedId ?? candidates[0]?.buildingId ?? null;
  const focusAnchor = focusId ? (index.get(focusId)?.anchor ?? null) : null;
  const focus = useMemo(
    () => (focusAnchor ? { lngLat: focusAnchor, zoom: 17.5 } : null),
    // Re-focus only when the focused building changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusId, focusAnchor?.[0], focusAnchor?.[1]],
  );

  return (
    <div className="flex flex-col gap-3">
      <MapPanel
        campus={campus}
        editing={editing}
        focus={focus}
        label="Candidate footprints on the campus map"
        className="h-64 rounded-md border border-border md:h-80"
      />
      <p className="text-xs text-muted">
        Dashed outlines are research candidates (unverified). The solid outline is the building chosen below.
        Click a building on the map to choose it.
      </p>
      {candidates.length === 0 ? (
        <p className="text-sm text-muted">No reviewed candidate footprint is recorded for this item.</p>
      ) : (
        <ol className="flex flex-col gap-2" aria-label="Candidate footprints (unverified research leads)">
          {candidates.map((c) => {
            const b = index.get(c.buildingId);
            const chosen = c.buildingId === selectedId;
            return (
              <li
                key={c.buildingId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium text-text">
                    #{c.rank} · <code className="break-all">{c.buildingId}</code>
                  </span>
                  <span className="text-xs text-muted">
                    {b ? b.displayName : 'Not in the current campus dataset'} · score {c.score.toFixed(2)} ·
                    shape match {c.shapeMatch}
                  </span>
                </div>
                {chosen ? (
                  <Badge tone="accent">Chosen</Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={disabled || !b}
                    onClick={() => onPick(c.buildingId)}
                  >
                    Use this building
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
