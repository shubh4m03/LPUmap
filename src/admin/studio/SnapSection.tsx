/**
 * Optional, visible snapping (S6): each button asks for a PROPOSAL that is
 * drawn on the map (role 'snap') with its explanation and the exact field
 * changes; it is applied only when the owner confirms, as one undoable
 * command. Unverified detected footprints can be shown as guides; a model
 * fitted to one records `geometryGuide` and stays unverified.
 */
import { proposeAngleSnap, proposeEdgeAlignment, proposeGuideFit } from '../../building-studio/geometry.ts';
import type { DetectionsFile } from '../../data/index.ts';
import { nearestBuildingOutline, nearestDetection } from '../../building-studio/ui/snap-targets.ts';
import { Button } from '../../components/ui/index.ts';
import { CheckField, PanelSection } from './controls.tsx';
import { useStudioServices, useStudioState } from './studio-context.ts';
import { useDraftEdit } from './useDraftEdit.ts';

export interface SnapSectionProps {
  showGuides: boolean;
  onShowGuides(v: boolean): void;
  detections: DetectionsFile | null;
  detectionsError: string | null;
}

export function SnapSection({ showGuides, onShowGuides, detections, detectionsError }: SnapSectionProps) {
  const { store, data } = useStudioServices();
  const { draft, editable, edit } = useDraftEdit();
  const v = useStudioState((s) => ({
    proposal: s.proposal,
    note: s.proposalNote,
    editingId: s.editor.targetId ?? s.editor.head?.id ?? null,
  }));
  if (!draft) return null;
  const m = draft.model;
  const prism = m.generatorId === 'footprint-prism';
  const show = (r: ReturnType<typeof proposeAngleSnap>) =>
    store.setState(
      r.ok ? { proposal: r, proposalNote: null } : { proposal: null, proposalNote: r.explanation },
    );
  const alignToBuilding = () => {
    if (!data) return;
    const t = nearestBuildingOutline(data.buildings, m, { excludeId: v.editingId });
    if (!t) {
      store.setState({
        proposal: null,
        proposalNote: 'No mapped building outline within 60 m of this model.',
      });
      return;
    }
    show(proposeEdgeAlignment(m, { label: t.label, coordinates: t.coordinates }));
  };
  const fitDetection = () => {
    if (!detections) return;
    const t = nearestDetection(detections, m);
    if (!t) {
      store.setState({
        proposal: null,
        proposalNote: 'No unverified detected footprint within 60 m of this model.',
      });
      return;
    }
    show(proposeGuideFit(m, { id: t.id, coordinates: t.coordinates }));
  };
  return (
    <PanelSection title="Snapping (optional)" id="studio-section-snapping" defaultOpen={false}>
      {prism ? (
        <p className="text-xs text-muted">The mapped footprint of an existing building is never snapped.</p>
      ) : (
        <>
          <p className="text-xs text-muted">
            Nothing snaps by itself. A proposal is shown on the map and changes nothing until you apply it.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" disabled={!editable} onClick={() => show(proposeAngleSnap(m, 15))}>
              Angle to 15°
            </Button>
            <Button size="sm" disabled={!editable} onClick={() => show(proposeAngleSnap(m, 90))}>
              Angle to 90°
            </Button>
            <Button size="sm" disabled={!editable || !data} onClick={alignToBuilding}>
              Align to nearest building
            </Button>
            <Button
              size="sm"
              disabled={!editable || !detections}
              onClick={fitDetection}
              title={detections ? undefined : 'Show the detected footprints first'}
            >
              Fit to detected footprint
            </Button>
          </div>
        </>
      )}
      <CheckField
        label="Show unverified detected footprints as guides"
        checked={showGuides}
        onChange={onShowGuides}
        hint="Machine-detected outlines (Microsoft, Google Open Buildings): guides only, not verified data."
      />
      {detectionsError ? <p className="text-xs text-danger">{detectionsError}</p> : null}
      {v.note ? (
        <p role="status" className="text-xs text-muted">
          {v.note}
        </p>
      ) : null}
      {v.proposal ? (
        <div
          className="flex flex-col gap-2 rounded-md border border-accent bg-accent-soft p-2.5"
          data-testid="studio-snap-proposal"
        >
          <p className="text-xs text-text">{v.proposal.explanation}</p>
          <ul className="text-xs text-muted">
            {v.proposal.changes.map((c) => (
              <li key={c.field}>
                {c.field}: {String(c.from ?? '—')} → {String(c.to ?? '—')}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={!editable}
              onClick={() => {
                const p = v.proposal;
                if (!p) return;
                edit((d) => ({ ...d, model: p.model }), `Apply ${p.kind} snapping`);
                store.setState({ proposal: null });
              }}
            >
              Apply proposal
            </Button>
            <Button size="sm" variant="ghost" onClick={() => store.setState({ proposal: null })}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}
    </PanelSection>
  );
}
