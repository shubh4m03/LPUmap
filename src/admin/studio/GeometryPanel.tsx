/**
 * Position, rotation, dimensions/floors and shape parameters of the open
 * model, in metres and degrees. Every handle action on the map also exists
 * here as numeric fields and step buttons (keyboard and touch; S13).
 * Values outside the publish range are accepted and flagged, never clamped.
 */
import { useState } from 'react';
import { Button, SegmentedControl } from '../../components/ui/index.ts';
import { cx } from '../../components/ui/cx.ts';
import {
  anchorFromCoordinates,
  NUDGE_STEPS,
  nudgeMove,
  resizeModel,
  rotateBy,
  setRotation,
  type Compass,
  type DimensionField,
} from '../../building-studio/geometry.ts';
import type { ModelConfigV1, ShapeParams } from '../../building-studio/schema.ts';
import {
  DIMENSION_LABELS,
  heightFloorsConflict,
  outsidePublishRange,
  publishRangeText,
} from '../../building-studio/ui/fields.ts';
import { useStudioServices, useStudioState } from './studio-context.ts';
import { CheckField, NumberField, PanelSection, SelectField } from './controls.tsx';
import { useDraftEdit } from './useDraftEdit.ts';

const ARROW: Readonly<Record<Compass, string>> = { west: '←', north: '↑', south: '↓', east: '→' };
const DIR_WORD: Readonly<Record<Compass, string>> = {
  west: 'West',
  north: 'North',
  south: 'South',
  east: 'East',
};

function StepRow(props: {
  label: string;
  steps: readonly number[];
  unit: string;
  value: number;
  onStep(v: number): void;
}) {
  return (
    <SegmentedControl<string>
      label={props.label}
      value={String(props.value)}
      onChange={(v) => props.onStep(Number(v))}
      options={props.steps.map((s) => ({ value: String(s), label: `${s} ${props.unit}` }))}
    />
  );
}

/**
 * Move / rotate / resize step buttons (S13: 0.5/1/5 m; ±1/±5/±15°). The
 * same controls on desktop (inspector) and on phones (the dock), where every
 * button is a 44 px touch target in four compact rows.
 */
export function StepControls() {
  const { draft, editable, edit } = useDraftEdit();
  const [step, setStep] = useState<number>(NUDGE_STEPS.moveM[1]);
  if (!draft) return null;
  const prism = draft.model.generatorId === 'footprint-prism';
  const disabled = !editable || prism;
  const move = (dir: Compass) =>
    edit((d) => ({ ...d, model: nudgeMove(d.model, dir, step) }), `Move ${step} m ${dir}`);
  const rotate = (deg: number) =>
    edit((d) => ({ ...d, model: rotateBy(d.model, deg) }), `Rotate ${deg > 0 ? '+' : ''}${deg}°`);
  const resize = (field: 'widthM' | 'lengthM', delta: number) =>
    edit(
      (d) => {
        const r = resizeModel(d.model, { [field]: Math.round((d.model[field] + delta) * 100) / 100 });
        return r.ok ? { ...d, model: r.model } : d;
      },
      `${field === 'widthM' ? 'Width' : 'Length'} ${delta > 0 ? '+' : ''}${delta} m`,
    );
  const btn = 'min-w-0 flex-1 px-1';
  return (
    <div className="flex flex-col gap-1.5" data-testid="studio-step-controls">
      {prism ? (
        <p className="text-xs text-muted">
          The mapped footprint of an existing building is authoritative: it is not moved, turned or resized
          here.
        </p>
      ) : null}
      <StepRow
        label="Step for moving and resizing"
        steps={NUDGE_STEPS.moveM}
        unit="m"
        value={step}
        onStep={setStep}
      />
      <div className="flex gap-1.5" role="group" aria-label={`Move ${step} m`}>
        {(['west', 'north', 'south', 'east'] as const).map((dir) => (
          <Button
            key={dir}
            size="sm"
            className={btn}
            disabled={disabled}
            onClick={() => move(dir)}
            aria-label={`Move ${step} m ${dir}`}
          >
            {/* The visible word is part of the accessible name (WCAG 2.5.3 label in name). */}
            {dir === 'east' ? null : <span aria-hidden="true">{ARROW[dir]}</span>}
            {DIR_WORD[dir]}
            {dir === 'east' ? <span aria-hidden="true">{ARROW[dir]}</span> : null}
          </Button>
        ))}
      </div>
      <div role="group" aria-label="Rotate" className="flex gap-1.5">
        {NUDGE_STEPS.rotateDeg
          .flatMap((deg) => [-deg, deg])
          .sort((a, b) => a - b)
          .map((deg) => (
            <Button
              key={deg}
              size="sm"
              className={btn}
              disabled={disabled}
              onClick={() => rotate(deg)}
              aria-label={`Rotate ${Math.abs(deg)}° ${deg > 0 ? 'clockwise' : 'anticlockwise'}`}
            >
              {deg > 0 ? `+${deg}°` : `${deg}°`}
            </Button>
          ))}
      </div>
      <div role="group" aria-label={`Resize by ${step} m`} className="flex gap-1.5">
        {(['widthM', 'lengthM'] as const).flatMap((f) =>
          [-1, 1].map((sign) => (
            <Button
              key={`${f}${sign}`}
              size="sm"
              className={btn}
              disabled={disabled}
              onClick={() => resize(f, sign * step)}
              // The name starts with the visible text (WCAG 2.5.3 label in name), then says it in words.
              aria-label={`${f === 'widthM' ? 'W' : 'L'} ${sign > 0 ? '+' : '−'}${step} (${sign > 0 ? 'increase' : 'decrease'} ${f === 'widthM' ? 'width' : 'length'} by ${step} m)`}
            >
              {f === 'widthM' ? 'W' : 'L'} {sign > 0 ? '+' : '−'}
              {step}
            </Button>
          )),
        )}
      </div>
    </div>
  );
}

export function PositionSection() {
  const { draft, editable, edit, blur } = useDraftEdit();
  if (!draft) return null;
  const m = draft.model;
  const prism = m.generatorId === 'footprint-prism';
  const setAnchor = (lon: number, lat: number) => {
    const r = anchorFromCoordinates(lon, lat);
    if (!r.ok) return r.message;
    // Outside the map area is accepted and flagged below (validation blocks publishing), never clamped.
    edit((d) => ({ ...d, model: { ...d.model, anchor: r.anchor } }), 'Type coordinates', 'model.anchor');
    return null;
  };
  const outside = (() => {
    const r = anchorFromCoordinates(m.anchor[0], m.anchor[1]);
    return r.ok && !r.insideMapArea;
  })();
  return (
    <PanelSection title="Position and rotation" id="studio-section-position">
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Longitude"
          unit="°"
          step={0.00001}
          value={m.anchor[0]}
          disabled={!editable || prism}
          onValue={(v) => setAnchor(v, m.anchor[1])}
          onBlur={blur}
          testId="studio-lon"
        />
        <NumberField
          label="Latitude"
          unit="°"
          step={0.00001}
          value={m.anchor[1]}
          disabled={!editable || prism}
          onValue={(v) => setAnchor(m.anchor[0], v)}
          onBlur={blur}
          testId="studio-lat"
        />
      </div>
      {outside ? (
        <p className="text-xs text-danger">This position is outside the map area: it cannot be published.</p>
      ) : null}
      <NumberField
        label="Rotation, clockwise from north"
        unit="°"
        step={1}
        value={m.rotationDeg}
        disabled={!editable || prism}
        onValue={(v) => {
          if (!Number.isFinite(v)) return 'Enter an angle.';
          edit((d) => ({ ...d, model: setRotation(d.model, v) }), 'Set rotation', 'model.rotationDeg');
          return null;
        }}
        onBlur={blur}
        testId="studio-rotation"
      />
      <StepControls />
    </PanelSection>
  );
}

const DIM_FIELDS: readonly DimensionField[] = [
  'widthM',
  'lengthM',
  'heightM',
  'floors',
  'floorHeightM',
  'baseOffsetM',
];

export function DimensionsSection() {
  const { store } = useStudioServices();
  const linkHeight = useStudioState((s) => s.linkHeight);
  const { draft, editable, edit, blur } = useDraftEdit();
  if (!draft) return null;
  const m = draft.model;
  const prism = m.generatorId === 'footprint-prism';
  const conflict = heightFloorsConflict(m);
  return (
    <PanelSection title="Dimensions and floors" id="studio-section-dimensions">
      <div className="grid grid-cols-2 gap-2">
        {DIM_FIELDS.map((f) => {
          const footprintField = f === 'widthM' || f === 'lengthM';
          return (
            <NumberField
              key={f}
              label={DIMENSION_LABELS[f]}
              unit={f === 'floors' ? undefined : 'm'}
              integer={f === 'floors'}
              step={f === 'floors' ? 1 : 0.5}
              value={m[f]}
              disabled={!editable || (prism && footprintField)}
              testId={`studio-dim-${f}`}
              warning={
                outsidePublishRange(f, m[f]) ? `Outside the publish range ${publishRangeText(f)}.` : null
              }
              hint={prism && footprintField ? 'From the mapped footprint (informational).' : undefined}
              onValue={(v) => {
                const r = resizeModel(m, { [f]: v }, { linkHeight });
                if (!r.ok) return r.message;
                edit(
                  (d) => {
                    const again = resizeModel(d.model, { [f]: v }, { linkHeight });
                    return again.ok ? { ...d, model: again.model } : d;
                  },
                  `Set ${DIMENSION_LABELS[f].toLowerCase()}`,
                  `model.${f}`,
                );
                return null;
              }}
              onBlur={blur}
            />
          );
        })}
      </div>
      <CheckField
        label="Body height follows floors × floor height"
        checked={linkHeight}
        onChange={(v) => store.setState({ linkHeight: v })}
        hint="When on, changing floors or floor height also sets the body height."
      />
      {conflict ? (
        <p
          role="note"
          className="rounded-md bg-warning-soft p-2 text-xs text-warning"
          data-testid="studio-height-conflict"
        >
          Height and floors disagree: {conflict.message} Publishing then needs an acknowledged warning.
        </p>
      ) : null}
      <p className="text-xs text-muted">
        Body height runs from the base to the eaves or flat roof; a pitched roof rises above it.
      </p>
    </PanelSection>
  );
}

function shapeFields(
  shape: ShapeParams,
): { key: string; label: string; min: number; max: number; step: number; integer?: boolean }[] {
  switch (shape.kind) {
    case 'l-shape':
      return [
        { key: 'notchWidthFrac', label: 'Notch width (share of width)', min: 0.2, max: 0.8, step: 0.05 },
        { key: 'notchLengthFrac', label: 'Notch length (share of length)', min: 0.2, max: 0.8, step: 0.05 },
      ];
    case 'u-shape':
      return [
        { key: 'courtyardWidthFrac', label: 'Courtyard width (share)', min: 0.2, max: 0.8, step: 0.05 },
        { key: 'courtyardDepthFrac', label: 'Courtyard depth (share)', min: 0.2, max: 0.8, step: 0.05 },
      ];
    case 'tower-podium':
      return [
        { key: 'podiumFloors', label: 'Podium floors', min: 1, max: 6, step: 1, integer: true },
        { key: 'towerWidthFrac', label: 'Tower width (share)', min: 0.25, max: 0.9, step: 0.05 },
        { key: 'towerLengthFrac', label: 'Tower length (share)', min: 0.25, max: 0.9, step: 0.05 },
      ];
    case 'kiosk-canopy':
      return [
        { key: 'canopyDepthFrac', label: 'Canopy depth (share of length)', min: 0.1, max: 0.6, step: 0.05 },
      ];
    case 'stepped':
      return [
        { key: 'tiers', label: 'Tiers', min: 2, max: 5, step: 1, integer: true },
        { key: 'setbackM', label: 'Setback per tier (m)', min: 0.5, max: 20, step: 0.5 },
      ];
    default:
      return [];
  }
}

const CHOICES: Partial<
  Record<ShapeParams['kind'], { key: string; label: string; options: readonly string[] }>
> = {
  'l-shape': {
    key: 'notchCorner',
    label: 'Notch corner',
    options: ['front-left', 'front-right', 'back-left', 'back-right'],
  },
  'u-shape': { key: 'openSide', label: 'Open side', options: ['front', 'back', 'left', 'right', 'none'] },
  'kiosk-canopy': { key: 'canopySide', label: 'Canopy side', options: ['front', 'back', 'left', 'right'] },
};

export function ShapeSection() {
  const { draft, editable, edit, blur } = useDraftEdit();
  if (!draft) return null;
  const m: ModelConfigV1 = draft.model;
  const fields = shapeFields(m.shape);
  const choice = CHOICES[m.shape.kind];
  if (fields.length === 0 && !choice) return null;
  const params = m.shape as unknown as Record<string, number | string>;
  return (
    <PanelSection title="Shape" id="studio-section-shape">
      <div className={cx('grid gap-2', fields.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
        {fields.map((f) => (
          <NumberField
            key={f.key}
            label={f.label}
            integer={f.integer}
            step={f.step}
            value={Number(params[f.key])}
            disabled={!editable}
            onValue={(v) => {
              if (v < f.min || v > f.max) return `Allowed ${f.min}–${f.max}.`;
              edit(
                (d) => ({
                  ...d,
                  model: { ...d.model, shape: { ...d.model.shape, [f.key]: v } as ShapeParams },
                }),
                `Set ${f.label.toLowerCase()}`,
                `model.shape.${f.key}`,
              );
              return null;
            }}
            onBlur={blur}
          />
        ))}
      </div>
      {choice ? (
        <SelectField
          label={choice.label}
          value={String(params[choice.key])}
          disabled={!editable}
          options={choice.options.map((o) => ({ value: o, label: o.replace('-', ' ') }))}
          onValue={(v) =>
            edit(
              (d) => ({
                ...d,
                model: { ...d.model, shape: { ...d.model.shape, [choice.key]: v } as ShapeParams },
              }),
              `Set ${choice.label.toLowerCase()}`,
            )
          }
        />
      ) : null}
    </PanelSection>
  );
}
