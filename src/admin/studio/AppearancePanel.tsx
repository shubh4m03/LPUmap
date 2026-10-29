/**
 * Roof, façade, colours, presets and detail level (S3: appearance only —
 * never a statement about the real building's materials). Roof shapes are
 * limited to what the model's generator can build (S14). "Before / after"
 * compares the saved version with the open draft as generated thumbnails.
 */
import { useMemo, useState } from 'react';
import { Button } from '../../components/ui/index.ts';
import {
  APPEARANCE_LABEL,
  DETAIL_LEVELS,
  FACADE_MATERIALS,
  PITCHED_ROOFS,
  ROOF_MATERIALS,
  SIDES,
  WINDOW_PATTERNS,
  type ModelConfigV1,
  type TemplateVariant,
} from '../../building-studio/index.ts';
import {
  APPEARANCE_PRESETS,
  applyPreset,
  normalizeColour,
  roofOptions,
  withRoofShape,
  withWindowPattern,
} from '../../building-studio/ui/index.ts';
import { modelThumbnailSvg } from '../../building-studio/editor.ts';
import { starterTemplate } from '../../building-studio/editor.ts';
import { CheckField, NumberField, PanelSection, SelectField } from './controls.tsx';
import { useStudioServices, useStudioState } from './studio-context.ts';
import { useDraftEdit } from './useDraftEdit.ts';

const DETAIL_LABELS = {
  massing: 'Massing (flat top, no windows)',
  roof: 'Roof shape',
  facade: 'Façade (window grids)',
  details: 'Details (balconies, entrance, trim)',
} as const;

const svgUrl = (svg: string | null) =>
  svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : undefined;

function ColourField(props: {
  label: string;
  value: string;
  disabled: boolean;
  onValue(v: string): void;
  onBlur(): void;
  testId?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium text-muted" id={`${props.testId}-label`}>
        {props.label}
      </span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-labelledby={`${props.testId}-label`}
          value={props.value}
          disabled={props.disabled}
          data-testid={props.testId}
          onBlur={props.onBlur}
          className="h-10 w-14 cursor-pointer rounded-md border border-border-strong bg-surface-sunken pointer-coarse:h-11"
          onChange={(e) => {
            const c = normalizeColour(e.target.value);
            if (c) props.onValue(c);
          }}
        />
        <code className="text-xs text-muted">{props.value}</code>
      </div>
    </div>
  );
}

/** The template variant the draft came from, when this build has it (for "reset"). */
function useTemplateVariant(): TemplateVariant | null {
  const { library } = useStudioServices();
  const ref = useStudioState((s) => s.editor.history?.present.templateRef ?? null);
  return useMemo(() => {
    if (!ref) return null;
    const item =
      library.items.find(
        (i) => i.definition.id === ref.templateId && i.definition.version === ref.templateVersion,
      ) ?? null;
    const def = item?.definition ?? starterTemplate(ref.templateId, ref.templateVersion)?.definition ?? null;
    return def?.variants.find((v) => v.id === ref.variantId) ?? null;
  }, [library.items, ref]);
}

export function AppearanceSection() {
  const { draft, editable, edit, blur } = useDraftEdit();
  const baseline = useStudioState((s) => s.baseline?.model ?? null);
  const variant = useTemplateVariant();
  const [compare, setCompare] = useState(false);
  if (!draft) return null;
  const m = draft.model;
  const set = (fn: (m: ModelConfigV1) => ModelConfigV1, label: string, key?: string) =>
    edit((d) => ({ ...d, model: fn(d.model) }), label, key);
  const pitched = PITCHED_ROOFS.includes(m.roof.shape);
  const roofs = roofOptions(m);
  return (
    <PanelSection title="Appearance" id="studio-section-appearance">
      <p className="rounded-md bg-info-soft p-2 text-xs text-info">
        {APPEARANCE_LABEL}. Patterns are synthetic, never photos.
      </p>
      <fieldset>
        <legend className="text-xs font-medium text-muted">Presets</legend>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {APPEARANCE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={!editable}
              onClick={() => set((mm) => applyPreset(mm, p), `Preset: ${p.label}`)}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border px-2 text-xs hover:bg-surface-hover disabled:opacity-50 pointer-coarse:min-h-11"
            >
              <span
                aria-hidden="true"
                className="size-3.5 rounded-sm border border-border"
                style={{ background: p.facade.wallColour }}
              />
              <span
                aria-hidden="true"
                className="size-3.5 rounded-sm border border-border"
                style={{ background: p.roof.colour }}
              />
              {p.label}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        <SelectField
          label="Roof shape"
          value={m.roof.shape}
          disabled={!editable}
          options={roofs.map((r) => ({ value: r, label: r }))}
          hint={roofs.length === 1 ? 'The only roof this shape generator can build.' : undefined}
          onValue={(v) =>
            set(
              (mm) => ({ ...mm, roof: withRoofShape(mm.roof, v as ModelConfigV1['roof']['shape']) }),
              'Roof shape',
            )
          }
        />
        {pitched ? (
          <NumberField
            label="Roof pitch"
            unit="°"
            step={1}
            value={m.roof.pitchDeg ?? 25}
            disabled={!editable}
            warning={
              (m.roof.pitchDeg ?? 25) < 5 || (m.roof.pitchDeg ?? 25) > 45
                ? 'Outside the publish range 5–45°.'
                : null
            }
            onValue={(v) => {
              if (!(v > 0 && v < 90)) return 'Enter a pitch between 0 and 90°.';
              set(
                (mm) => ({ ...mm, roof: { ...mm.roof, pitchDeg: v } }),
                'Roof pitch',
                'model.roof.pitchDeg',
              );
              return null;
            }}
            onBlur={blur}
          />
        ) : null}
        <SelectField
          label="Roof material"
          value={m.roof.material}
          disabled={!editable}
          options={ROOF_MATERIALS.map((r) => ({ value: r, label: r }))}
          onValue={(v) =>
            set(
              (mm) => ({ ...mm, roof: { ...mm.roof, material: v as ModelConfigV1['roof']['material'] } }),
              'Roof material',
            )
          }
        />
        <ColourField
          label="Roof colour"
          value={m.roof.colour}
          disabled={!editable}
          testId="studio-roof-colour"
          onBlur={blur}
          onValue={(c) =>
            set((mm) => ({ ...mm, roof: { ...mm.roof, colour: c } }), 'Roof colour', 'model.roof.colour')
          }
        />
        <SelectField
          label="Wall material"
          value={m.facade.material}
          disabled={!editable}
          options={FACADE_MATERIALS.map((r) => ({ value: r, label: r }))}
          onValue={(v) =>
            set(
              (mm) => ({
                ...mm,
                facade: { ...mm.facade, material: v as ModelConfigV1['facade']['material'] },
              }),
              'Wall material',
            )
          }
        />
        <ColourField
          label="Wall colour"
          value={m.facade.wallColour}
          disabled={!editable}
          testId="studio-wall-colour"
          onBlur={blur}
          onValue={(c) =>
            set(
              (mm) => ({ ...mm, facade: { ...mm.facade, wallColour: c } }),
              'Wall colour',
              'model.facade.wallColour',
            )
          }
        />
        <SelectField
          label="Windows"
          value={m.facade.windowPattern}
          disabled={!editable}
          options={WINDOW_PATTERNS.map((r) => ({ value: r, label: r }))}
          onValue={(v) =>
            set(
              (mm) => ({
                ...mm,
                facade: withWindowPattern(mm.facade, v as ModelConfigV1['facade']['windowPattern']),
              }),
              'Window pattern',
            )
          }
        />
        {m.facade.windowPattern !== 'none' ? (
          <NumberField
            label="Window density (0–1)"
            step={0.05}
            value={m.facade.windowDensity}
            disabled={!editable}
            onValue={(v) => {
              if (!(v > 0 && v <= 1)) return 'Enter a value above 0 and up to 1.';
              set(
                (mm) => ({ ...mm, facade: { ...mm.facade, windowDensity: v } }),
                'Window density',
                'model.facade.windowDensity',
              );
              return null;
            }}
            onBlur={blur}
          />
        ) : null}
        <SelectField
          label="Entrance marker"
          value={m.facade.entranceSide}
          disabled={!editable}
          options={[...SIDES, 'none'].map((r) => ({ value: r, label: r }))}
          hint="A visual marker only, never a routing connection."
          onValue={(v) =>
            set(
              (mm) => ({
                ...mm,
                facade: { ...mm.facade, entranceSide: v as ModelConfigV1['facade']['entranceSide'] },
              }),
              'Entrance marker',
            )
          }
        />
        <SelectField
          label="Detail level"
          className="col-span-2"
          value={m.detailLevel}
          disabled={!editable}
          options={DETAIL_LEVELS.map((r) => ({ value: r, label: DETAIL_LABELS[r] }))}
          onValue={(v) =>
            set((mm) => ({ ...mm, detailLevel: v as ModelConfigV1['detailLevel'] }), 'Detail level')
          }
        />
      </div>
      <CheckField
        label="Balconies"
        checked={m.facade.balconies}
        disabled={!editable}
        hint="Drawn at the Details level; meant for residential types."
        onChange={(v) =>
          set(
            (mm) => ({ ...mm, facade: { ...mm.facade, balconies: v } }),
            v ? 'Add balconies' : 'Remove balconies',
          )
        }
      />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          icon="reset"
          disabled={!editable || !variant}
          title={
            variant
              ? 'Roof, façade and detail level back to the template variant'
              : 'The template of this model is not available'
          }
          onClick={() =>
            variant &&
            set(
              (mm) => ({
                ...mm,
                roof: structuredClone(variant.defaults.roof),
                facade: structuredClone(variant.defaults.facade),
                detailLevel: variant.defaults.detailLevel,
              }),
              'Reset appearance',
            )
          }
        >
          Reset appearance
        </Button>
        <Button
          size="sm"
          variant={compare ? 'primary' : 'secondary'}
          aria-pressed={compare}
          onClick={() => setCompare((c) => !c)}
        >
          Before / after
        </Button>
      </div>
      {compare ? <BeforeAfter before={baseline} after={m} /> : null}
    </PanelSection>
  );
}

function BeforeAfter({ before, after }: { before: ModelConfigV1 | null; after: ModelConfigV1 }) {
  const b = useMemo(() => (before ? svgUrl(modelThumbnailSvg(before, { size: 140 })) : undefined), [before]);
  const a = useMemo(() => svgUrl(modelThumbnailSvg(after, { size: 140 })), [after]);
  return (
    <div className="grid grid-cols-2 gap-2" data-testid="studio-before-after">
      <figure className="flex flex-col items-center gap-1">
        {b ? (
          <img
            src={b}
            alt=""
            width={120}
            height={120}
            className="size-30 rounded-md border border-border bg-surface"
          />
        ) : (
          <div className="flex size-30 items-center justify-center rounded-md border border-dashed border-border p-2 text-center text-xs text-muted">
            Not saved yet
          </div>
        )}
        <figcaption className="text-xs text-muted">Before (saved)</figcaption>
      </figure>
      <figure className="flex flex-col items-center gap-1">
        {a ? (
          <img
            src={a}
            alt=""
            width={120}
            height={120}
            className="size-30 rounded-md border border-border bg-surface"
          />
        ) : null}
        <figcaption className="text-xs text-muted">After (this draft)</figcaption>
      </figure>
    </div>
  );
}
