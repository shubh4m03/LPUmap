/**
 * History (append-only audit log): filters by record type, record id and
 * action; newest first with "Load older"; field-level before/after; revert
 * where the server supports it (location and override changes). A revert is
 * a NEW change — history is never rewritten.
 */
import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/index.ts';
import { EmptyState } from '../../components/ui/index.ts';
import { Spinner } from '../../components/ui/index.ts';
import { TextInput } from '../../components/ui/index.ts';
import { useToast } from '../../components/ui/index.ts';
import type { AdminApiError } from '../api/errors.ts';
import type { AuditEvent } from '../api/schemas.ts';
import { useAdminApi } from '../context.ts';
import { useAction } from '../hooks/useAction.ts';
import { useResource } from '../hooks/useResource.ts';
import { ActionDialog } from '../ui/ActionDialog.tsx';
import { ErrorNotice } from '../ui/ErrorNotice.tsx';
import { SelectField } from '../ui/fields.tsx';
import { formatDateTime } from '../ui/format.ts';
import { Page } from '../ui/Page.tsx';
import { AuditEventList } from './audit/AuditEventList.tsx';
import {
  ACTION_LABELS,
  actionLabel,
  auditFiltersQuery,
  ENTITY_LABELS,
  parseAuditFilters,
  type AuditFilters,
} from './audit/audit-model.ts';
import type { AdminSectionProps } from './types.ts';

const PAGE = 50;

interface Older {
  key: string;
  items: AuditEvent[];
  nextCursor: number | null;
  loading: boolean;
  error: AdminApiError | null;
}

export default function AuditSection({ route, navigate }: AdminSectionProps) {
  const api = useAdminApi();
  const toast = useToast();
  const filters = parseAuditFilters(route.query);
  const key = JSON.stringify(filters);
  const query = (cursor?: number) => ({
    ...(filters.entity ? { entity: filters.entity } : {}),
    ...(filters.entityId ? { entityId: filters.entityId } : {}),
    ...(filters.action ? { action: filters.action } : {}),
    limit: PAGE,
    ...(cursor ? { cursor } : {}),
  });
  const list = useResource(key, (signal) => api.community.listAudit(query(), { signal }));
  const [older, setOlder] = useState<Older | null>(null);
  const [draft, setDraft] = useState(filters);
  const [synced, setSynced] = useState(key);
  if (synced !== key) {
    setSynced(key);
    setDraft(filters);
  }
  const [reverting, setReverting] = useState<AuditEvent | null>(null);
  const revert = useAction();

  const pages = older?.key === key ? older : null;
  const items = [...(list.state.data?.items ?? []), ...(pages?.items ?? [])];
  const nextCursor = pages ? pages.nextCursor : (list.state.data?.nextCursor ?? null);

  const go = (f: AuditFilters) => navigate({ section: 'audit', query: auditFiltersQuery(f) });
  const loadOlder = async () => {
    if (!nextCursor) return;
    setOlder({ key, items: pages?.items ?? [], nextCursor, loading: true, error: null });
    const r = await api.community.listAudit(query(nextCursor));
    setOlder((m) => {
      const base = m && m.key === key ? m.items : [];
      return r.ok
        ? {
            key,
            items: [...base, ...r.data.items],
            nextCursor: r.data.nextCursor,
            loading: false,
            error: null,
          }
        : { key, items: base, nextCursor, loading: false, error: r.error };
    });
  };
  const reloadAll = () => {
    setOlder(null);
    list.reload();
  };

  return (
    <Page
      title="History"
      description="Every change made through the admin and every public submission, newest first. Entries cannot be edited or removed."
      wide
      actions={
        <Button size="sm" icon="reset" onClick={reloadAll} loading={list.state.status === 'loading'}>
          Refresh
        </Button>
      }
    >
      <form
        className="grid grid-cols-1 gap-3 md:grid-cols-[12rem_1fr_14rem_auto] md:items-end"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          go({ ...draft, entityId: draft.entityId.trim(), action: draft.action.trim() });
        }}
      >
        <SelectField
          label="Record type"
          value={draft.entity ?? ''}
          onChange={(e) => {
            const entity = (Object.keys(ENTITY_LABELS) as Array<keyof typeof ENTITY_LABELS>).find(
              (k) => k === e.target.value,
            );
            go({ ...draft, entity: entity ?? null });
          }}
          options={[
            { value: '', label: 'All types' },
            ...Object.entries(ENTITY_LABELS).map(([value, label]) => ({ value, label })),
          ]}
        />
        <TextInput
          label="Record id"
          autoComplete="off"
          spellCheck={false}
          value={draft.entityId}
          onChange={(e) => setDraft({ ...draft, entityId: e.target.value })}
        />
        <SelectField
          label="Action"
          value={draft.action}
          onChange={(e) => go({ ...draft, action: e.target.value })}
          options={[
            { value: '', label: 'All actions' },
            ...(draft.action && !(draft.action in ACTION_LABELS)
              ? [{ value: draft.action, label: draft.action }]
              : []),
            ...Object.keys(ACTION_LABELS).map((a) => ({ value: a, label: actionLabel(a) })),
          ]}
        />
        <div className="flex gap-2">
          <Button type="submit" variant="secondary">
            Apply
          </Button>
          {filters.entity || filters.entityId || filters.action ? (
            <Button variant="ghost" onClick={() => go({ entity: null, entityId: '', action: '' })}>
              Clear
            </Button>
          ) : null}
        </div>
      </form>

      {list.state.status === 'error' ? (
        <ErrorNotice error={list.state.error} title="Could not load the history" onReload={list.reload} />
      ) : null}
      {list.state.status === 'loading' && !list.state.data ? (
        <Spinner label="Loading the history…" />
      ) : list.state.data && items.length === 0 ? (
        <EmptyState icon="history" title="No matching events" />
      ) : list.state.data ? (
        <>
          <AuditEventList
            events={items}
            navigate={navigate}
            onRevert={(e) => {
              revert.clear();
              setReverting(e);
            }}
          />
          {pages?.error ? (
            <ErrorNotice error={pages.error} title="Could not load older events" onReload={loadOlder} />
          ) : null}
          {nextCursor ? (
            <Button
              className="self-center"
              loading={pages?.loading ?? false}
              onClick={() => void loadOlder()}
            >
              Load older events
            </Button>
          ) : (
            <p className="text-center text-sm text-muted">This is the oldest matching event.</p>
          )}
        </>
      ) : null}

      {reverting ? (
        <ActionDialog
          open
          title="Revert this change?"
          description={`Restores the values from before “${actionLabel(reverting.action)}” on ${formatDateTime(reverting.at)} as a new change. It is refused if the record has changed since; an access point is checked again and never replaced.`}
          confirmLabel="Revert"
          busy={revert.busy}
          error={revert.error}
          errorTitle="Nothing was reverted"
          onReload={reloadAll}
          onClose={() => setReverting(null)}
          onConfirm={async () => {
            const r = await revert.run(() => api.community.revert(reverting.id));
            if (r) {
              setReverting(null);
              toast.show({
                message: `Reverted. ${r.entityId} has its earlier values again.`,
                tone: 'success',
              });
              reloadAll();
            }
          }}
        />
      ) : null}
    </Page>
  );
}
