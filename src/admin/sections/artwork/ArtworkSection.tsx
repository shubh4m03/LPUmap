/**
 * Artwork: /admin/artwork (every item the campus illustration depicts, with
 * its exact label and link status; ?view=files lists every artwork file)
 * and /admin/artwork/<subject id> (the decision page).
 *
 * The owner links illustration items to campus buildings here. A link is
 * "verified" only with recorded evidence; "approximate" is shown publicly
 * only as an unconfirmed match and never routed. Building Studio stays
 * separate: nothing here writes image files or studio records.
 */
import { useMemo, useState } from 'react';
import { Button } from '../../../components/ui/Button.tsx';
import { cx, FOCUS_RING } from '../../../components/ui/cx.ts';
import { EmptyState } from '../../../components/ui/EmptyState.tsx';
import { SegmentedControl } from '../../../components/ui/SegmentedControl.tsx';
import { Spinner } from '../../../components/ui/Spinner.tsx';
import { SearchInput } from '../../../components/ui/TextInput.tsx';
import { ILLUSTRATION_DISCLAIMER, type IsometricArtManifest } from '../../../isometric-art/schema.ts';
import { useAdminApi } from '../../context.ts';
import { useResource } from '../../hooks/useResource.ts';
import { adminHref } from '../../routes.ts';
import { ErrorNotice } from '../../ui/ErrorNotice.tsx';
import { onInAppClick } from '../../ui/links.ts';
import { Page, Section } from '../../ui/Page.tsx';
import type { AdminSectionProps } from '../types.ts';
import { OriginalImage } from './ArtworkImages.tsx';
import {
  artworkRows,
  filterRows,
  parseStatusFilter,
  SOURCE_LABELS,
  statusCounts,
  type StatusFilter,
} from './artwork-model.ts';
import { AssociationEditor, Exact } from './AssociationEditor.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import { useArtworkManifest } from './useArtworkManifest.ts';

export default function ArtworkSection({ route, navigate }: AdminSectionProps) {
  const manifest = useArtworkManifest();
  const [listQuery, setListQuery] = useState(route.query);
  if (!route.id && listQuery !== route.query) setListQuery(route.query);
  if (manifest.status !== 'ready') {
    return (
      <Page title="Artwork">
        {manifest.status === 'error' ? (
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-md border border-border bg-danger-soft p-3 text-sm"
          >
            <p>{manifest.message}</p>
            <Button size="sm" icon="reset" className="w-fit" onClick={manifest.retry}>
              Try again
            </Button>
          </div>
        ) : (
          <Spinner label="Loading the illustration…" />
        )}
      </Page>
    );
  }
  if (route.id) {
    return (
      <AssociationEditor
        key={route.id}
        subjectId={route.id}
        manifest={manifest.manifest}
        navigate={navigate}
        back={{
          href: adminHref({ section: 'artwork', query: listQuery }),
          label: 'Artwork',
          onNavigate: () => navigate({ section: 'artwork', query: listQuery }),
        }}
      />
    );
  }
  return route.query.view === 'files' ? (
    <ArtworkFiles manifest={manifest.manifest} navigate={navigate} />
  ) : (
    <ArtworkList
      manifest={manifest.manifest}
      status={parseStatusFilter(route.query)}
      initialQ={route.query.q ?? ''}
      navigate={navigate}
    />
  );
}

function ViewSwitch({
  value,
  navigate,
}: {
  value: 'items' | 'files';
  navigate: AdminSectionProps['navigate'];
}) {
  return (
    <SegmentedControl
      label="View"
      value={value}
      onChange={(v) => navigate({ section: 'artwork', query: v === 'files' ? { view: 'files' } : {} })}
      options={[
        { value: 'items', label: 'Illustrated items' },
        { value: 'files', label: 'Artwork files' },
      ]}
    />
  );
}

function ArtworkList({
  manifest,
  status,
  initialQ,
  navigate,
}: {
  manifest: IsometricArtManifest;
  status: StatusFilter;
  initialQ: string;
  navigate: AdminSectionProps['navigate'];
}) {
  const api = useAdminApi();
  const list = useResource('artwork-associations', (signal) => api.artwork.listAssociations({ signal }));
  const [q, setQ] = useState(initialQ);
  const rows = useMemo(
    () => artworkRows(manifest, list.state.data?.items ?? null),
    [manifest, list.state.data],
  );
  const counts = useMemo(() => statusCounts(rows), [rows]);
  const visible = useMemo(() => filterRows(rows, status, q), [rows, status, q]);
  const mine = rows.filter((r) => r.view?.decision).length;
  const go = (s: StatusFilter) => navigate({ section: 'artwork', query: s === 'all' ? {} : { status: s } });

  return (
    <Page
      title="Artwork"
      wide
      description={
        <>
          Link items of the owner-supplied campus illustration to campus buildings. {ILLUSTRATION_DISCLAIMER}{' '}
          Illustration numbers are the artwork’s own numbering, never official block numbers.
        </>
      }
      actions={
        <Button size="sm" icon="reset" onClick={list.reload} loading={list.state.status === 'loading'}>
          Refresh
        </Button>
      }
    >
      <ViewSwitch value="items" navigate={navigate} />
      <SearchInput
        label="Find an item by printed label, number or id"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onClear={() => setQ('')}
      />
      <SegmentedControl
        label="Show"
        value={status}
        onChange={go}
        options={[
          { value: 'all', label: `All (${rows.length})` },
          { value: 'verified', label: `Verified (${counts.verified})` },
          { value: 'approximate', label: `Unconfirmed (${counts.approximate})` },
          { value: 'unresolved', label: `Unresolved (${counts.unresolved})` },
          { value: 'mine', label: `Your decisions (${mine})` },
          { value: 'review', label: 'Needs review' },
        ]}
      />
      {list.state.status === 'error' ? (
        <ErrorNotice
          error={list.state.error}
          title="Could not load the artwork links"
          onReload={list.reload}
        />
      ) : null}
      {(list.state.data?.issues.length ?? 0) > 0 ? (
        <Section title="Problems">
          <ul className="list-disc ps-5 text-sm text-text">
            {list.state.data!.issues.map((i) => (
              <li key={`${i.subjectId}:${i.code}`}>
                <code>{i.subjectId}</code>: {i.message}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {list.state.status === 'loading' && !list.state.data ? (
        <Spinner label="Loading the artwork links…" />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="search"
          title="No item matches"
          description="Change the filter or the search text."
        />
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Illustrated items">
          {visible.map((r) => (
            <li key={r.subject.subjectId}>
              <a
                href={adminHref({ section: 'artwork', id: r.subject.subjectId })}
                onClick={onInAppClick(() => navigate({ section: 'artwork', id: r.subject.subjectId }))}
                className={cx(
                  'flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-raised px-3 py-2 hover:bg-surface-hover',
                  FOCUS_RING,
                )}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium text-text">
                    <Exact text={r.title} />
                  </span>
                  <span className="text-xs text-muted">
                    <code>{r.subject.subjectId}</code>
                    {r.subject.artworkNumber !== null ? ` · illustration no. ${r.subject.artworkNumber}` : ''}
                    {r.view?.effective.buildingId ? ` · ${r.view.effective.buildingId}` : ''}
                    {r.view?.effective.unconfirmedMatchId
                      ? ` · unconfirmed: ${r.view.effective.unconfirmedMatchId}`
                      : ''}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  {r.view ? <StatusBadge status={r.view.effective.status} /> : null}
                  {r.view ? (
                    <span className="text-xs text-muted">{SOURCE_LABELS[r.view.effective.source]}</span>
                  ) : null}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

function ArtworkFiles({
  manifest,
  navigate,
}: {
  manifest: IsometricArtManifest;
  navigate: AdminSectionProps['navigate'];
}) {
  return (
    <Page
      title="Artwork files"
      wide
      description="Every file the owner supplied, shown unchanged (published byte-identical copies). Labels are transcribed exactly as printed."
    >
      <ViewSwitch value="files" navigate={navigate} />
      <ul className="grid gap-4 md:grid-cols-2" aria-label="Artwork files">
        {manifest.assets.map((a) => (
          <li
            key={a.assetId}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-3"
          >
            <OriginalImage manifest={manifest} assetId={a.assetId} lazy />
            <p className="text-xs text-muted">
              {a.kind} · sha256 <code className="break-all">{a.source.sha256.slice(0, 16)}…</code>
              {a.duplicateOf ? ` · duplicate of ${a.duplicateOf} (not published separately)` : ''}
            </p>
            {a.labels.length > 0 ? (
              <details>
                <summary className="cursor-pointer text-sm font-medium text-text">
                  Printed labels ({a.labels.length})
                </summary>
                <ul className="mt-1 flex flex-col gap-1 text-sm">
                  {a.labels.map((l) => (
                    <li key={l.labelId}>
                      <Exact text={l.text} /> <code className="text-xs text-muted">{l.labelId}</code>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </li>
        ))}
      </ul>
    </Page>
  );
}
