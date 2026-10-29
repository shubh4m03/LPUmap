/**
 * Keyboard / numeric control for a point's position (every map action also
 * exists here): latitude and longitude fields, "Use the map centre" (the
 * centre reticle on phones, the map centre elsewhere) and 1 m step buttons.
 */
import { useState, type KeyboardEvent } from 'react';
import { Button } from '../../components/ui/index.ts';
import { IconButton } from '../../components/ui/index.ts';
import { TextInput } from '../../components/ui/index.ts';
import type { LngLat } from '../../data/index.ts';
import { isValidLngLat } from '../../distance/index.ts';
import { nudge, round7 } from './preview.ts';

export interface PositionFieldsProps {
  value: LngLat | null;
  onChange(p: LngLat): void;
  /** Current map centre (reticle), when the map has reported one. */
  mapCenter: LngLat | null;
  /** Phones: the centre reticle is the placement tool, so its button is the primary action. */
  reticle: boolean;
  disabled?: boolean;
  error?: string | null;
}

const fmt = (v: number | undefined) => (v === undefined ? '' : String(round7(v)));

export function PositionFields({
  value,
  onChange,
  mapCenter,
  reticle,
  disabled,
  error,
}: PositionFieldsProps) {
  const [lat, setLat] = useState(fmt(value?.[1]));
  const [lon, setLon] = useState(fmt(value?.[0]));
  const [fieldError, setFieldError] = useState<string | null>(null);

  // A new value from outside (map click, drag, step) replaces whatever is typed.
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setLat(fmt(value?.[1]));
    setLon(fmt(value?.[0]));
    setFieldError(null);
  }

  const commit = () => {
    if (lat.trim() === '' && lon.trim() === '' && value === null) return;
    const p: LngLat = [Number(lon), Number(lat)];
    if (lat.trim() === '' || lon.trim() === '' || !isValidLngLat(p)) {
      setFieldError('Enter a latitude between -90 and 90 and a longitude between -180 and 180.');
      return;
    }
    setFieldError(null);
    if (!value || round7(p[0]) !== round7(value[0]) || round7(p[1]) !== round7(value[1]))
      onChange([round7(p[0]), round7(p[1])]);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    }
  };
  const step = (east: number, north: number) => {
    if (value) onChange(nudge(value, east, north));
  };

  return (
    <fieldset className="flex flex-col gap-3" disabled={disabled}>
      <legend className="mb-1 text-sm font-semibold text-text">Position</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextInput
          label="Latitude"
          inputMode="decimal"
          autoComplete="off"
          value={lat}
          onChange={(e) => setLat(e.target.value)}
          onBlur={commit}
          onKeyDown={onKey}
        />
        <TextInput
          label="Longitude"
          inputMode="decimal"
          autoComplete="off"
          value={lon}
          onChange={(e) => setLon(e.target.value)}
          onBlur={commit}
          onKeyDown={onKey}
        />
      </div>
      {fieldError || error ? (
        <p role="alert" className="text-sm text-danger">
          {fieldError ?? error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {reticle || mapCenter ? (
          <Button
            size="sm"
            variant={reticle ? 'primary' : 'secondary'}
            icon="pin"
            disabled={!mapCenter}
            onClick={() => mapCenter && onChange(mapCenter)}
          >
            {reticle ? 'Place at the centre pin' : 'Use the map centre'}
          </Button>
        ) : null}
        {value ? (
          <div role="group" aria-label="Move the point 1 metre" className="flex items-center gap-1">
            <span aria-hidden="true" className="ps-1 pe-1 text-sm text-muted">
              Move 1 m
            </span>
            <IconButton icon="chevron-up" label="Move 1 m north" size="sm" onClick={() => step(0, 1)} />
            <IconButton icon="chevron-down" label="Move 1 m south" size="sm" onClick={() => step(0, -1)} />
            <IconButton icon="chevron-left" label="Move 1 m west" size="sm" onClick={() => step(-1, 0)} />
            <IconButton icon="chevron-right" label="Move 1 m east" size="sm" onClick={() => step(1, 0)} />
          </div>
        ) : null}
      </div>
      <p className="text-sm text-muted">
        {reticle
          ? 'Pan the map until the centre pin is on the place, then tap “Place at the centre pin”.'
          : 'Click the map to place the point and drag its handle to adjust it, or type the coordinates.'}
      </p>
    </fieldset>
  );
}
