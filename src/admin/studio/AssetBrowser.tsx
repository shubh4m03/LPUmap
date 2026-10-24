/**
 * Searchable, categorised template library (owner spec B; S2, S3, S14).
 * Every card shows its generated thumbnail, intended use, defaults, allowed
 * roofs and façades, computed render cost and the honest accuracy badge
 * ("Generic prefab": an illustrative massing model, never a real building).
 * Retired templates are not offered for new placements.
 */
import { useMemo, useState } from 'react';
import { Badge, Button, EmptyState, SearchInput } from '../../components/ui/index.ts';
import { cx, FOCUS_RING } from '../../components/ui/cx.ts';
import { LIBRARY_CATEGORY_LABELS, searchLibrary } from '../../building-studio/asset-library.ts';
import {
  LIBRARY_CATEGORIES,
  type LibraryCategory,
  type TemplateDefinition,
} from '../../building-studio/schema.ts';
import {
  ACCURACY_LABELS,
  RENDER_COST_LABELS,
  variantDefaultsText,
  variantThumbnailUrl,
  type StudioLibraryItem,
} from '../../building-studio/ui/library.ts';
import { categoryLabel } from '../../building-studio/ui/fields.ts';
import { SelectField } from './controls.tsx';
import { useStudioServices } from './studio-context.ts';

export interface AssetBrowserProps {
  onPlace(def: TemplateDefinition, variantId: string): void;
  /** Placing is not possible right now (unsaved changes): the reason. */
  disabledReason?: string | null;
}

const keyOf = (i: StudioLibraryItem) => `${i.source}:${i.definition.id}`;

export function AssetBrowser({ onPlace, disabledReason }: AssetBrowserProps) {
  const { library } = useStudioServices();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<LibraryCategory | 'all'>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [turn, setTurn] = useState<0 | 1 | 2 | 3>(0);

  const placeable = useMemo(() => library.items.filter((i) => i.status === 'active'), [library.items]);
  const results = useMemo(() => {
    const found = searchLibrary(query, placeable) as StudioLibraryItem[];
    return category === 'all' ? found : found.filter((i) => i.definition.libraryCategory === category);
  }, [query, category, placeable]);
  const current = results.find((i) => keyOf(i) === selected) ?? null;
  const variant =
    current?.definition.variants.find((v) => v.id === variantId) ?? current?.definition.variants[0];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-border p-3">
        <SearchInput
          label="Search templates"
          hideLabel
          placeholder="Search templates (e.g. hostel, canteen)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery('')}
        />
        <SelectField
          label="Category"
          value={category}
          options={[
            { value: 'all', label: 'All categories' },
            ...LIBRARY_CATEGORIES.map((c) => ({ value: c, label: LIBRARY_CATEGORY_LABELS[c] })),
          ]}
          onValue={(v) => setCategory(v as LibraryCategory | 'all')}
        />
        {library.status === 'fallback' ? (
          <p role="status" className="text-xs text-warning">
            {library.message}
          </p>
        ) : library.status === 'loading' ? (
          <p role="status" className="text-xs text-muted">
            Loading the owner&rsquo;s templates… the built-in ones are shown meanwhile.
          </p>
        ) : null}
        <p className="text-xs text-muted" aria-live="polite">
          {results.length} {results.length === 1 ? 'template' : 'templates'}
        </p>
      </div>

      {current && variant ? (
        <section
          aria-label="Template preview"
          className="border-b border-border bg-surface-sunken p-3"
          data-testid="studio-template-preview"
        >
          <div className="flex gap-3">
            <div className="flex shrink-0 flex-col items-center gap-1">
              <img
                src={variantThumbnailUrl(current, variant.id, turn) ?? undefined}
                alt=""
                width={112}
                height={112}
                className="size-28 rounded-md border border-border bg-surface"
              />
              <Button
                size="sm"
                variant="ghost"
                icon="reset"
                onClick={() => setTurn((t) => ((t + 1) % 4) as 0 | 1 | 2 | 3)}
                title="Turn the preview by 90°"
              >
                Turn
              </Button>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <h3 className="text-sm font-semibold">{current.definition.name}</h3>
              <p className="text-xs text-muted">{current.definition.intendedUse}</p>
              <p className="text-xs">{variantDefaultsText(variant)}</p>
              <p className="text-xs text-muted">
                Suggested category: {categoryLabel(current.definition.suggestedCategoryId)}
              </p>
              <p className="text-xs text-muted">
                Roofs: {current.definition.constraints.roofShapes.join(', ')} · Façades:{' '}
                {current.definition.constraints.windowPatterns.join(', ')}
              </p>
              <p className="text-xs text-muted">
                {RENDER_COST_LABELS[current.definition.renderCost]} · about{' '}
                {current.variantStats.find((s) => s.variantId === variant.id)?.triangles ?? '?'} triangles ·{' '}
                {ACCURACY_LABELS[current.definition.accuracyClass]}
              </p>
            </div>
          </div>
          {current.definition.variants.length > 1 ? (
            <fieldset className="mt-2">
              <legend className="text-xs font-medium text-muted">Variant</legend>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {current.definition.variants.map((vr) => (
                  <label
                    key={vr.id}
                    className={cx(
                      'flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs pointer-coarse:min-h-11',
                      vr.id === variant.id
                        ? 'border-accent bg-accent-soft text-accent-text'
                        : 'border-border',
                    )}
                  >
                    <input
                      type="radio"
                      name="studio-variant"
                      className="accent-accent"
                      checked={vr.id === variant.id}
                      onChange={() => setVariantId(vr.id)}
                    />
                    {vr.name}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <p className="mt-2 text-xs text-muted">
            Illustrative generic template: shape and appearance are not any real building&rsquo;s design.
          </p>
          <Button
            className="mt-2"
            variant="primary"
            size="sm"
            icon="plus"
            fullWidth
            disabled={Boolean(disabledReason)}
            title={disabledReason ?? undefined}
            onClick={() => onPlace(current.definition, variant.id)}
            data-testid="studio-place-template"
          >
            Place on the map
          </Button>
          {disabledReason ? <p className="mt-1 text-xs text-warning">{disabledReason}</p> : null}
        </section>
      ) : null}

      <ul className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="Templates">
        {results.length === 0 ? (
          <li>
            <EmptyState
              icon="search"
              title="No template matches"
              description="Try another word or category. Only active templates are listed here."
            />
          </li>
        ) : null}
        {results.map((item) => {
          const d = item.definition;
          const k = keyOf(item);
          const isSel = k === selected;
          return (
            <li key={k} className="mb-1.5">
              <button
                type="button"
                aria-pressed={isSel}
                data-testid={`studio-template-${d.id}`}
                onClick={() => {
                  setSelected(isSel ? null : k);
                  setVariantId(null);
                  setTurn(0);
                }}
                className={cx(
                  'flex w-full gap-2.5 rounded-lg border p-2 text-left',
                  isSel ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-hover',
                  FOCUS_RING,
                )}
              >
                <img
                  src={variantThumbnailUrl(item) ?? undefined}
                  alt=""
                  width={64}
                  height={64}
                  loading="lazy"
                  className="size-16 shrink-0 rounded-md border border-border bg-surface"
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm leading-tight font-medium">{d.name}</span>
                  <span className="text-xs text-muted">
                    {item.categoryLabel} · v{d.version}
                    {item.source === 'owner' ? ' · your template' : ''}
                  </span>
                  <span className="line-clamp-2 text-xs text-muted">{d.intendedUse}</span>
                  <span className="text-xs">{d.variants[0] ? variantDefaultsText(d.variants[0]) : ''}</span>
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    <Badge tone="neutral">{ACCURACY_LABELS[d.accuracyClass]}</Badge>
                    <Badge tone={d.renderCost === 'high' ? 'warning' : 'neutral'}>
                      {RENDER_COST_LABELS[d.renderCost]}
                    </Badge>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
