/**
 * Choosing a studio building's access point on the map (S7): while picking,
 * the map shows every walkable path node within the server's limit of the
 * footprint (the only valid choices); a click lists the ones near it and the
 * owner picks one. Nothing is chosen automatically, and the building does not
 * move. Works the same on desktop (click) and phones (tap).
 */
import { useEffect } from 'react';
import { Button } from '../../components/ui/index.ts';
import { APP_CONFIG } from '../../config/index.ts';
import { useStudio } from '../../building-studio/ui/index.ts';
import { ACCESS_PICK_RADIUS_M, candidatesNearClick, nearClickSummary } from '../map/access-pick.ts';
import { formatMetres } from '../ui/format.ts';
import { useStudioAccessCandidates } from './access-pick-data.ts';
import { useStudioServices } from './studio-context.ts';
import { useDraftEdit } from './useDraftEdit.ts';

export function AccessPickCard() {
  const { store } = useStudioServices();
  const pick = useStudio(store, (s) => s.accessPick);
  const candidates = useStudioAccessCandidates();
  const { draft, editable, edit } = useDraftEdit();
  const active = pick !== null;

  // Picking ends with the building (closed, archived) and on Escape.
  useEffect(() => {
    if (active && (!editable || candidates === null)) store.setState({ accessPick: null });
  }, [active, editable, candidates, store]);
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) store.setState({ accessPick: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, store]);

  if (!pick || !draft || !candidates) return null;
  const nearby = pick.click ? candidatesNearClick(candidates, pick.click) : null;
  const choose = (nodeId: number) => {
    edit((d) => ({ ...d, accessNodeId: nodeId }), 'Access point (chosen on the map)');
    store.setState({ accessPick: null });
  };
  return (
    <section
      aria-label="Choose the access point"
      data-testid="studio-access-pick"
      // Compact (one header row, one line per node) so the nodes above it stay visible for another tap.
      className="absolute inset-x-2 bottom-2 z-(--ds-z-controls) mx-auto flex max-w-md flex-col gap-1.5 rounded-xl border border-accent bg-surface-raised px-3 py-2 text-sm shadow-3"
    >
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 font-semibold">Choose the access point</h2>
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0"
          onClick={() => store.setState({ accessPick: null })}
          data-testid="studio-access-pick-cancel"
        >
          Stop choosing
        </Button>
      </div>
      <p role="status" className="text-text">
        {nearby === null
          ? `Tap or click near the building: the ${candidates.length} highlighted path nodes (walkable, within ${APP_CONFIG.routing.maxPlaceConnectorM} m of the footprint) are the valid ones, and a tap lists those within ${ACCESS_PICK_RADIUS_M} m of it. Nothing is chosen until you pick one.`
          : nearClickSummary(nearby.length)}
      </p>
      {nearby && nearby.length > 0 ? (
        <ul className="flex flex-col gap-1" aria-label="Path nodes near the click">
          {nearby.map((c) => (
            <li key={c.nodeId} className="flex items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                className="shrink-0"
                onClick={() => choose(c.nodeId)}
                data-testid={`studio-access-choose-${c.nodeId}`}
              >
                Use path node {c.nodeId}
              </Button>
              <span className="min-w-0 text-xs leading-4 text-muted">
                {formatMetres(c.distanceM)} from the building · {formatMetres(c.fromClickM)} from the tap
                {c.nodeId === draft.accessNodeId ? ' · current' : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
