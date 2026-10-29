/**
 * Template library management (owner spec B; S2, S3, S11, S14):
 *  - built-in (code) templates: read-only, with every variant and version;
 *  - the owner's templates: create from a built-in one, publish a new
 *    immutable version, retire (hidden from new placements only) or bring
 *    back. Existing buildings never change when a template does.
 *  - GLB/glTF import is shown as NOT enabled, with the reason.
 * Owner templates are only ever "generic prefab" or "stylized": never
 * presented as evidence about a real building.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Badge, Button, EmptyState, ErrorState, Spinner } from '../../components/ui/index.ts';
import { LIBRARY_CATEGORY_LABELS } from '../../building-studio/editor.ts';
import {
  LIBRARY_CATEGORIES,
  ownerTemplateInputSchema,
  STUDIO_LIMITS,
  type OwnerTemplateInput,
  type TemplateDefinition,
} from '../../building-studio/index.ts';
import { categoryLabel, STUDIO_CATEGORY_OPTIONS } from '../../building-studio/ui/index.ts';
import {
  ACCURACY_LABELS,
  libraryItems,
  RENDER_COST_LABELS,
  variantDefaultsText,
  variantThumbnailUrl,
  type StudioLibraryItem,
} from '../../building-studio/ui/index.ts';
import { describeAdminError } from '../api/errors.ts';
import { useAdminApi } from '../context.ts';
import type { AdminSectionProps } from '../sections/types.ts';
import { NumberField, SelectField, TextField } from './controls.tsx';

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: StudioLibraryItem[] };

type Editing = { mode: 'create'; base: TemplateDefinition } | { mode: 'version'; item: StudioLibraryItem };

export default function TemplatesSection({ route, navigate }: AdminSectionProps) {
  const api = useAdminApi();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    void api.studio.library({ signal: ctl.signal }).then((r) => {
      if (ctl.signal.aborted) return;
      if (r.ok) setLoad({ status: 'ready', items: libraryItems(r.data.templates) });
      else if (r.error.kind !== 'aborted') setLoad({ status: 'error', message: describeAdminError(r.error) });
    });
    return () => ctl.abort();
  }, [api, attempt]);

  const items = load.status === 'ready' ? load.items : [];
  const owner = items.filter((i) => i.source === 'owner');
  const code = items.filter((i) => i.source === 'code');

  const retire = async (item: StudioLibraryItem, retired: boolean) => {
    if (item.revision === null) return;
    setBusy(item.definition.id);
    setMessage(null);
    const body = { revision: item.revision };
    const r = retired
      ? await api.studio.unretireTemplate(item.definition.id, body)
      : await api.studio.retireTemplate(item.definition.id, body);
    setBusy(null);
    if (!r.ok) {
      setMessage({ tone: 'danger', text: describeAdminError(r.error) });
      return;
    }
    setMessage({
      tone: 'success',
      text: retired
        ? `${item.definition.name} is offered for new placements again.`
        : `${item.definition.name} is retired: hidden from new placements. Existing buildings are unchanged.`,
    });
    setAttempt((a) => a + 1);
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Templates</h1>
        <p className="text-sm text-muted">
          Templates are generic starting points. A building keeps its own full configuration: retiring a
          template or publishing a new version never changes a placed building.
        </p>
      </header>
      {message ? (
        <p
          role={message.tone === 'danger' ? 'alert' : 'status'}
          className={
            message.tone === 'danger'
              ? 'rounded-md bg-danger-soft p-2 text-sm text-danger'
              : 'rounded-md bg-success-soft p-2 text-sm text-success'
          }
        >
          {message.text}
        </p>
      ) : null}
      {editing ? (
        <TemplateForm
          editing={editing}
          onCancel={() => setEditing(null)}
          onSaved={(text) => {
            setEditing(null);
            setMessage({ tone: 'success', text });
            setAttempt((a) => a + 1);
          }}
        />
      ) : null}
      {load.status === 'loading' ? (
        <Spinner label="Loading templates…" />
      ) : load.status === 'error' ? (
        <ErrorState
          title="Could not load the templates"
          message={load.message}
          onRetry={() => setAttempt((a) => a + 1)}
        />
      ) : (
        <>
          <section aria-labelledby="owner-templates" className="flex flex-col gap-3">
            <h2 id="owner-templates" className="text-base font-semibold">
              Your templates ({owner.length})
            </h2>
            {owner.length === 0 ? (
              <EmptyState
                icon="building"
                title="No templates of your own yet"
                description="Create one from a built-in template below (“Make my own from this”)."
              />
            ) : (
              owner.map((item) => (
                <TemplateCard
                  key={item.definition.id}
                  item={item}
                  expanded={route.id === item.definition.id}
                  onToggle={() =>
                    navigate(
                      {
                        section: 'templates',
                        id: route.id === item.definition.id ? null : item.definition.id,
                      },
                      { replace: true },
                    )
                  }
                  actions={
                    <>
                      <Button
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => setEditing({ mode: 'version', item })}
                      >
                        New version
                      </Button>
                      <Button
                        size="sm"
                        variant={item.status === 'retired' ? 'secondary' : 'ghost'}
                        loading={busy === item.definition.id}
                        disabled={busy !== null}
                        onClick={() => void retire(item, item.status === 'retired')}
                      >
                        {item.status === 'retired' ? 'Bring back' : 'Retire'}
                      </Button>
                    </>
                  }
                />
              ))
            )}
          </section>
          <section aria-labelledby="code-templates" className="flex flex-col gap-3">
            <h2 id="code-templates" className="text-base font-semibold">
              Built-in templates ({code.length})
            </h2>
            <p className="text-sm text-muted">
              Part of the app (versioned in code): they cannot be edited or retired here.
            </p>
            {code.map((item) => (
              <TemplateCard
                key={item.definition.id}
                item={item}
                expanded={route.id === item.definition.id}
                onToggle={() =>
                  navigate(
                    { section: 'templates', id: route.id === item.definition.id ? null : item.definition.id },
                    { replace: true },
                  )
                }
                actions={
                  <Button size="sm" onClick={() => setEditing({ mode: 'create', base: item.definition })}>
                    Make my own from this
                  </Button>
                }
              />
            ))}
          </section>
        </>
      )}
      <section aria-labelledby="glb-import" className="rounded-xl border border-dashed border-border p-4">
        <h2 id="glb-import" className="text-base font-semibold">
          Import a 3D model (GLB / glTF)
        </h2>
        <p className="mt-1 text-sm text-muted">
          Not enabled. A file validator exists (size, triangles, embedded data, licence and attribution), but
          storing imported models needs file storage (an R2 binding) and drawing them needs the Three.js
          adoption gate. Neither is in place, so no imported model can be saved or shown yet.
        </p>
        <Button
          className="mt-3"
          size="sm"
          disabled
          title="Not enabled: no model storage or renderer for imported files"
        >
          Import a model (not enabled)
        </Button>
      </section>
    </div>
  );
}

function TemplateCard(props: {
  item: StudioLibraryItem;
  expanded: boolean;
  onToggle(): void;
  actions: ReactNode;
}) {
  const { item } = props;
  const d = item.definition;
  return (
    <article
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface-raised p-3"
      data-testid={`template-card-${d.id}`}
    >
      <div className="flex gap-3">
        <img
          src={variantThumbnailUrl(item) ?? undefined}
          alt=""
          width={72}
          height={72}
          loading="lazy"
          className="size-18 shrink-0 rounded-md border border-border bg-surface"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{d.name}</h3>
            <Badge tone={item.status === 'retired' ? 'danger' : 'success'}>
              {item.status === 'retired' ? 'Retired' : 'Active'}
            </Badge>
            <Badge tone="neutral">{ACCURACY_LABELS[d.accuracyClass]}</Badge>
            <Badge tone="neutral">{RENDER_COST_LABELS[d.renderCost]}</Badge>
          </div>
          <p className="text-xs text-muted">
            {LIBRARY_CATEGORY_LABELS[d.libraryCategory]} · suggested category{' '}
            {categoryLabel(d.suggestedCategoryId)} · version {d.version} (versions: {item.versions.join(', ')}
            )
          </p>
          <p className="text-sm">{d.intendedUse}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" aria-expanded={props.expanded} onClick={props.onToggle}>
          {props.expanded
            ? 'Hide variants'
            : `Show ${d.variants.length} ${d.variants.length === 1 ? 'variant' : 'variants'}`}
        </Button>
        {props.actions}
      </div>
      {props.expanded ? (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {d.variants.map((v) => (
            <li key={v.id} className="flex gap-2 rounded-lg border border-border p-2">
              <img
                src={variantThumbnailUrl(item, v.id) ?? undefined}
                alt=""
                width={56}
                height={56}
                className="size-14 shrink-0 rounded-md border border-border bg-surface"
              />
              <div className="min-w-0">
                <p className="text-sm font-medium">{v.name}</p>
                <p className="text-xs text-muted">{variantDefaultsText(v)}</p>
                <p className="text-xs text-muted">
                  Roof {v.defaults.roof.shape} · windows {v.defaults.facade.windowPattern} ·{' '}
                  {v.defaults.detailLevel}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

/** Runs a field update and reports "no error" (the form validates the whole template). */
const applied = (fn: () => void): null => {
  fn();
  return null;
};

function inputFrom(def: TemplateDefinition, basedOn: OwnerTemplateInput['basedOn']): OwnerTemplateInput {
  return {
    name: def.name,
    libraryCategory: def.libraryCategory,
    intendedUse: def.intendedUse,
    suggestedCategoryId: def.suggestedCategoryId,
    generatorId: def.generatorId,
    generatorVersion: def.generatorVersion,
    constraints: structuredClone(def.constraints),
    variants: structuredClone(def.variants),
    accuracyClass: def.accuracyClass === 'stylized' ? 'stylized' : 'generic-prefab',
    basedOn,
  };
}

function TemplateForm({
  editing,
  onCancel,
  onSaved,
}: {
  editing: Editing;
  onCancel(): void;
  onSaved(text: string): void;
}) {
  const api = useAdminApi();
  const [input, setInput] = useState<OwnerTemplateInput>(() =>
    editing.mode === 'create'
      ? {
          ...inputFrom(editing.base, { templateId: editing.base.id, templateVersion: editing.base.version }),
          name: `${editing.base.name} (my variant)`.slice(0, STUDIO_LIMITS.templateName.max),
        }
      : inputFrom(editing.item.definition, null),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = useMemo(() => ownerTemplateInputSchema.safeParse(input), [input]);
  const issues = parsed.success
    ? []
    : parsed.error.issues.map((i) => `${i.path.join('.') || 'template'}: ${i.message}`);
  const set = (patch: Partial<OwnerTemplateInput>) => setInput((i) => ({ ...i, ...patch }));
  const setVariant = (
    k: number,
    patch: Partial<OwnerTemplateInput['variants'][number]['defaults']>,
    name?: string,
  ) =>
    setInput((i) => ({
      ...i,
      variants: i.variants.map((v, j) =>
        j === k
          ? { ...v, ...(name !== undefined ? { name } : {}), defaults: { ...v.defaults, ...patch } }
          : v,
      ),
    }));

  const submit = async () => {
    if (!parsed.success) return;
    setBusy(true);
    setError(null);
    const r =
      editing.mode === 'create'
        ? await api.studio.createTemplate(parsed.data)
        : await api.studio.updateTemplate(editing.item.definition.id, {
            revision: editing.item.revision ?? 0,
            definition: parsed.data,
          });
    setBusy(false);
    if (!r.ok) {
      setError(describeAdminError(r.error));
      return;
    }
    onSaved(
      editing.mode === 'create'
        ? `Created “${r.data.definition.name}” (version ${r.data.definition.version}).`
        : `Published version ${r.data.definition.version} of “${r.data.definition.name}”. Existing buildings keep their own configuration.`,
    );
  };

  return (
    <section
      aria-label="Template form"
      className="flex flex-col gap-4 rounded-xl border border-accent bg-surface-raised p-4"
    >
      <h2 className="text-base font-semibold">
        {editing.mode === 'create'
          ? `New template based on ${editing.base.name} v${editing.base.version}`
          : `New version of ${editing.item.definition.name}`}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Name"
          value={input.name}
          maxLength={STUDIO_LIMITS.templateName.max}
          onChange={(name) => set({ name })}
        />
        <SelectField
          label="Library category"
          value={input.libraryCategory}
          options={LIBRARY_CATEGORIES.map((c) => ({ value: c, label: LIBRARY_CATEGORY_LABELS[c] }))}
          onValue={(v) => set({ libraryCategory: v as OwnerTemplateInput['libraryCategory'] })}
        />
        <TextField
          label="Intended use"
          value={input.intendedUse}
          maxLength={STUDIO_LIMITS.intendedUse}
          onChange={(intendedUse) => set({ intendedUse })}
        />
        <SelectField
          label="Suggested category"
          value={input.suggestedCategoryId}
          options={STUDIO_CATEGORY_OPTIONS.map((c) => ({ value: c.id, label: c.label }))}
          onValue={(suggestedCategoryId) => set({ suggestedCategoryId })}
        />
        <SelectField
          label="Accuracy class"
          value={input.accuracyClass}
          options={[
            { value: 'generic-prefab', label: 'Generic prefab' },
            { value: 'stylized', label: 'Stylized' },
          ]}
          hint="Owner templates are never presented as source-backed or surveyed."
          onValue={(v) => set({ accuracyClass: v as OwnerTemplateInput['accuracyClass'] })}
        />
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold">
          Guidance ranges (placing outside them is a warning, never clamped)
        </legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(['widthM', 'lengthM', 'heightM', 'floors'] as const).flatMap((k) =>
            (['min', 'max'] as const).map((b) => (
              <NumberField
                key={`${k}-${b}`}
                label={`${k.replace('M', '')} ${b}`}
                integer={k === 'floors'}
                value={input.constraints[k][b]}
                onValue={(v) => {
                  setInput((i) => ({
                    ...i,
                    constraints: { ...i.constraints, [k]: { ...i.constraints[k], [b]: v } },
                  }));
                  return null;
                }}
              />
            )),
          )}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold">Variants ({input.variants.length})</legend>
        {input.variants.map((v, k) => (
          <div
            key={v.id}
            className="grid grid-cols-2 gap-2 rounded-lg border border-border p-2 sm:grid-cols-4"
          >
            <div className="col-span-2">
              <TextField
                label={`Variant ${k + 1} name`}
                value={v.name}
                onChange={(name) => setVariant(k, {}, name)}
              />
            </div>
            <NumberField
              label="Width (m)"
              value={v.defaults.widthM}
              onValue={(x) => applied(() => setVariant(k, { widthM: x }))}
            />
            <NumberField
              label="Length (m)"
              value={v.defaults.lengthM}
              onValue={(x) => applied(() => setVariant(k, { lengthM: x }))}
            />
            <NumberField
              label="Body height (m)"
              value={v.defaults.heightM}
              onValue={(x) => applied(() => setVariant(k, { heightM: x }))}
            />
            <NumberField
              label="Floors"
              integer
              value={v.defaults.floors}
              onValue={(x) => applied(() => setVariant(k, { floors: x }))}
            />
            <NumberField
              label="Floor height (m)"
              value={v.defaults.floorHeightM}
              onValue={(x) => applied(() => setVariant(k, { floorHeightM: x }))}
            />
            <div className="flex items-end">
              <Button
                size="sm"
                variant="ghost"
                disabled={input.variants.length <= 1}
                onClick={() => setInput((i) => ({ ...i, variants: i.variants.filter((_, j) => j !== k) }))}
              >
                Remove variant
              </Button>
            </div>
          </div>
        ))}
      </fieldset>
      {issues.length > 0 ? (
        <ul role="status" className="rounded-md bg-warning-soft p-2 text-xs text-warning">
          {issues.slice(0, 8).map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-md bg-danger-soft p-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" loading={busy} disabled={!parsed.success} onClick={() => void submit()}>
          {editing.mode === 'create' ? 'Create template' : 'Publish new version'}
        </Button>
      </div>
    </section>
  );
}
