/**
 * The model's template provenance and the explicit "Apply template vN"
 * action (S2: a template update never changes an instance silently). The
 * preview lists every field the template would replace with before/after
 * values; placement and dimensions are kept, and values outside the new
 * template's guidance become warnings — nothing is clamped.
 */
import { useMemo, useState } from 'react';
import { Badge, Button } from '../../components/ui/index.ts';
import { starterTemplate } from '../../building-studio/asset-library.ts';
import { templateAvailability } from '../../building-studio/template-compat.ts';
import type { TemplateDefinition } from '../../building-studio/schema.ts';
import type { ApplyTemplatePreview } from '../../building-studio/ui/actions.ts';
import { fieldLabel, valueAt } from '../../building-studio/ui/text.ts';
import { PanelSection, SelectField } from './controls.tsx';
import { useStudioServices, useStudioState } from './studio-context.ts';
import { useDraftEdit } from './useDraftEdit.ts';

export function TemplateSection() {
  const { library, actions } = useStudioServices();
  const { draft, editable } = useDraftEdit();
  const pending = useStudioState((s) => s.editor.pending !== null);
  const ref = draft?.templateRef ?? null;
  const active = useMemo(() => library.items.filter((i) => i.status === 'active'), [library.items]);
  const [templateKey, setTemplateKey] = useState<string>('');
  const [version, setVersion] = useState<number | null>(null);
  const [variantId, setVariantId] = useState<string>('');
  const [preview, setPreview] = useState<ApplyTemplatePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const availability = useMemo(
    () =>
      templateAvailability(
        ref,
        library.items.map((i) => ({
          status: i.status,
          definitions: i.versions
            .map((v) =>
              v === i.definition.version
                ? i.definition
                : (starterTemplate(i.definition.id, v)?.definition ?? null),
            )
            .filter((d): d is TemplateDefinition => d !== null),
        })),
      ),
    [ref, library.items],
  );

  const item = active.find((i) => `${i.source}:${i.definition.id}` === templateKey) ?? null;
  const versions = item ? [...item.versions].reverse() : [];
  const chosenVersion = version ?? item?.definition.version ?? null;
  const def: TemplateDefinition | null = item
    ? chosenVersion === item.definition.version
      ? item.definition
      : (starterTemplate(item.definition.id, chosenVersion ?? undefined)?.definition ?? null)
    : null;
  const variant = def?.variants.find((v) => v.id === variantId) ?? def?.variants[0] ?? null;

  if (!draft) return null;

  const runPreview = async () => {
    if (!def || !variant) return;
    setBusy(true);
    setError(null);
    const r = await actions.previewTemplate(def, variant.id);
    setBusy(false);
    if ('error' in r) setError(r.error);
    else setPreview(r);
  };

  return (
    <PanelSection title="Template" id="studio-section-template" defaultOpen={false}>
      {ref ? (
        <p className="text-sm">
          From <strong>{ref.templateId}</strong> v{ref.templateVersion}, variant {ref.variantId}{' '}
          {availability.label ? <Badge tone="warning">{availability.label}</Badge> : null}
        </p>
      ) : (
        <p className="text-sm text-muted">
          No template: this model uses the mapped footprint of an existing building.
        </p>
      )}
      <p className="text-xs text-muted">
        The model keeps its own full configuration: later template versions never change it unless you apply
        one here.
      </p>
      <SelectField
        label="Apply template"
        value={templateKey}
        disabled={!editable}
        options={[
          { value: '', label: 'Choose a template…' },
          ...active.map((i) => ({
            value: `${i.source}:${i.definition.id}`,
            label: `${i.definition.name}${i.source === 'owner' ? ' (yours)' : ''}`,
          })),
        ]}
        onValue={(v) => {
          setTemplateKey(v);
          setVersion(null);
          setVariantId('');
          setPreview(null);
        }}
      />
      {item ? (
        <div className="grid grid-cols-2 gap-2">
          <SelectField
            label="Version"
            value={String(chosenVersion)}
            options={versions.map((v) => ({ value: String(v), label: `v${v}` }))}
            onValue={(v) => {
              setVersion(Number(v));
              setPreview(null);
            }}
          />
          <SelectField
            label="Variant"
            value={variant?.id ?? ''}
            options={(def?.variants ?? []).map((v) => ({ value: v.id, label: v.name }))}
            onValue={(v) => {
              setVariantId(v);
              setPreview(null);
            }}
          />
        </div>
      ) : null}
      {item && !def ? (
        <p className="text-xs text-warning">That version cannot be previewed in this browser.</p>
      ) : null}
      {item && def && variant ? (
        <Button size="sm" loading={busy} disabled={!editable || pending} onClick={() => void runPreview()}>
          Preview changes
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      {preview ? (
        <div
          className="flex flex-col gap-2 rounded-md border border-border p-2.5"
          data-testid="studio-template-diff"
        >
          <p className="text-xs font-medium">
            Apply {preview.ref.templateId} v{preview.ref.templateVersion} ({preview.ref.variantId}):{' '}
            {preview.source === 'server'
              ? 'checked by the server, nothing saved yet'
              : 'computed here; saved with the next draft save'}
          </p>
          {preview.changedFields.length === 0 ? (
            <p className="text-xs text-muted">Nothing would change.</p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-muted">
                  <th className="py-1 pr-2 font-medium">Field</th>
                  <th className="py-1 pr-2 font-medium">Before</th>
                  <th className="py-1 font-medium">After</th>
                </tr>
              </thead>
              <tbody>
                {preview.changedFields.map((p) => (
                  <tr key={p} className="border-t border-border align-top">
                    <td className="py-1 pr-2">{fieldLabel(p)}</td>
                    <td className="py-1 pr-2 break-all">{valueAt(preview.before, p)}</td>
                    <td className="py-1 break-all">{valueAt(preview.after, p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {preview.warnings.map((w) => (
            <p key={w} className="text-xs text-warning">
              {w}
            </p>
          ))}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={!editable || pending || preview.changedFields.length === 0}
              onClick={() => void actions.applyTemplate(preview).then((ok) => ok && setPreview(null))}
            >
              Apply template v{preview.ref.templateVersion}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}
    </PanelSection>
  );
}
