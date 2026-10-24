/**
 * Placement of a template variant: a translucent preview moved by a map
 * click, the centre handle, typed coordinates or metre offsets (desktop), or
 * by panning the map under a fixed centre pin (mobile). The server check of
 * the would-be draft runs live, so boundary, overlap and path feedback (with
 * reasons) is visible before anything is created. Nothing is stored until
 * the owner confirms and then saves the draft.
 */
import { useState } from 'react';
import type { LngLat } from '../../data/schema.ts';
import { Button } from '../../components/ui/index.ts';
import { anchorFromCoordinates, moveByMetres } from '../../building-studio/geometry.ts';
import { currentValidation } from '../../building-studio/ui/store.ts';
import { NumberField } from './controls.tsx';
import { useStudioServices, useStudioState } from './studio-context.ts';

export function PlacementBar({
  templateName,
  onFocus,
}: {
  templateName: string;
  /** Brings the preview into view after a typed position. */
  onFocus?(anchor: LngLat): void;
}) {
  const { store, actions, isMobile } = useStudioServices();
  const v = useStudioState((s) => ({
    model: s.editor.placement?.model ?? null,
    result: currentValidation(s),
    validating: s.validating,
    validationError: s.validationError,
  }));
  const [east, setEast] = useState(0);
  const [north, setNorth] = useState(0);
  if (!v.model) return null;
  const m = v.model;
  const issues = v.result?.issues.filter((i) => i.severity !== 'info') ?? [];
  return (
    <section
      aria-label="Placement"
      data-testid="studio-placement"
      className="pointer-events-auto flex w-full max-w-2xl flex-col gap-3 rounded-xl border border-border bg-surface-raised p-3 shadow-3"
    >
      <div>
        <h2 className="text-sm font-semibold">Placing: {templateName}</h2>
        <p className="text-xs text-muted">
          {isMobile
            ? 'Pan the map: the building goes where the centre pin is. Then confirm.'
            : 'Click the map, drag the centre handle, or type a position. Then confirm.'}{' '}
          Preview only: nothing is saved yet.
        </p>
      </div>
      {!isMobile ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <NumberField
            label="Longitude"
            unit="°"
            step={0.00001}
            value={m.anchor[0]}
            testId="studio-place-lon"
            onBlur={() => onFocus?.(m.anchor)}
            onValue={(lon) => {
              const r = anchorFromCoordinates(lon, m.anchor[1]);
              if (!r.ok) return r.message;
              store.dispatch({ type: 'placement/move', anchor: r.anchor });
              return null;
            }}
          />
          <NumberField
            label="Latitude"
            unit="°"
            step={0.00001}
            value={m.anchor[1]}
            testId="studio-place-lat"
            onBlur={() => onFocus?.(m.anchor)}
            onValue={(lat) => {
              const r = anchorFromCoordinates(m.anchor[0], lat);
              if (!r.ok) return r.message;
              store.dispatch({ type: 'placement/move', anchor: r.anchor });
              return null;
            }}
          />
          <NumberField
            label="Move east"
            unit="m"
            value={east}
            onValue={(x) => {
              setEast(x);
              return null;
            }}
            testId="studio-place-east"
          />
          <NumberField
            label="Move north"
            unit="m"
            value={north}
            onValue={(y) => {
              setNorth(y);
              return null;
            }}
            testId="studio-place-north"
          />
          <div className="col-span-2 flex items-end sm:col-span-4">
            <Button
              size="sm"
              disabled={east === 0 && north === 0}
              onClick={() => {
                const moved = moveByMetres(m, east, north);
                store.dispatch({ type: 'placement/update', model: moved });
                onFocus?.(moved.anchor);
                setEast(0);
                setNorth(0);
              }}
            >
              Move by {east} m east, {north} m north
            </Button>
          </div>
        </div>
      ) : null}
      <div role="status" aria-live="polite" className="text-xs" data-testid="studio-placement-check">
        {v.validationError ? (
          <span className="text-danger">{v.validationError}</span>
        ) : !v.result ? (
          <span className="text-muted">{v.validating ? 'Checking this position…' : 'Not checked yet.'}</span>
        ) : issues.length === 0 ? (
          <span className="text-success">No problems here (checked by the server).</span>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {issues.slice(0, 4).map((i, k) => (
              <li key={`${i.code}-${k}`} className={i.severity === 'error' ? 'text-danger' : 'text-warning'}>
                {i.severity === 'error' ? 'Error' : 'Warning'}: {i.message}
              </li>
            ))}
            {issues.length > 4 ? <li className="text-muted">…and {issues.length - 4} more.</li> : null}
          </ul>
        )}
      </div>
      <div className="flex gap-2">
        <Button
          variant="ghost"
          size={isMobile ? 'lg' : 'md'}
          className="flex-1"
          onClick={() => store.dispatch({ type: 'placement/cancel' })}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size={isMobile ? 'lg' : 'md'}
          className="flex-1"
          icon="check"
          data-testid="studio-confirm-placement"
          onClick={() => actions.confirmPlacement()}
        >
          Place here
        </Button>
      </div>
    </section>
  );
}
