/**
 * One suggestion: what was submitted, where (map), possible duplicates
 * (recomputed by the server), its history, and the moderation actions its
 * state allows.
 */
import { useMemo, useState } from 'react';
import { Badge } from '../../../components/ui/Badge.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import { cx, FOCUS_RING } from '../../../components/ui/cx.ts';
import { EmptyState } from '../../../components/ui/EmptyState.tsx';
import { Spinner } from '../../../components/ui/Spinner.tsx';
import { useToast } from '../../../components/ui/toast-context.ts';
import type { DuplicateCandidate } from '../../../community/schema.ts';
import type { SuggestionRecord } from '../../api/schemas.ts';
import { useAdminApi } from '../../context.ts';
import { useAdminCampusData } from '../../data/campus-data.ts';
import { useResource } from '../../hooks/useResource.ts';
import { MapPanel } from '../../map/MapPanel.tsx';
import { usePointEditing } from '../../map/usePointEditing.ts';
import type { AdminNavigate } from '../../router.ts';
import { adminHref } from '../../routes.ts';
import { AuditEventList } from '../audit/AuditEventList.tsx';
import { ErrorNotice } from '../../ui/ErrorNotice.tsx';
import {
  categoryLabel,
  formatDateTime,
  formatLngLat,
  SUGGESTION_STATUS_LABELS,
  SUGGESTION_STATUS_TONES,
} from '../../ui/format.ts';
import { Facts, Page, Section } from '../../ui/Page.tsx';
import { onInAppClick } from '../../ui/links.ts';
import { ApprovePanel } from './ApprovePanel.tsx';
import {
  DuplicateDialog,
  EditSuggestionDialog,
  RejectDialog,
  ReopenDialog,
  RequestInfoDialog,
} from './ModerationDialogs.tsx';
import { rememberedQueueQuery } from './remembered.ts';
import { moderationActions, type ModerationAction } from './queue-model.ts';

type Open = { kind: Exclude<ModerationAction, 'approve'>; target?: string } | null;

const ACTION_LABELS: Record<ModerationAction, string> = {
  edit: 'Edit',
  approve: 'Approve…',
  'request-info': 'Needs information…',
  reject: 'Reject…',
  duplicate: 'Mark as duplicate…',
  reopen: 'Reopen',
};

const KIND_LABEL: Record<DuplicateCandidate['kind'], string> = {
  place: 'Base place',
  location: 'Published location',
  suggestion: 'Suggestion',
};

export function SuggestionDetail({ id, navigate }: { id: string; navigate: AdminNavigate }) {
  const api = useAdminApi();
  const toast = useToast();
  const campus = useAdminCampusData();
  const detail = useResource(`suggestion:${id}`, (signal) => api.community.getSuggestion(id, { signal }));
  const [approving, setApproving] = useState(false);
  const [open, setOpen] = useState<Open>(null);

  const back = {
    href: adminHref({ section: 'queue', query: rememberedQueueQuery() }),
    label: 'Moderation queue',
    onNavigate: () => navigate({ section: 'queue', query: rememberedQueueQuery() }),
  };
  const s = detail.state.data?.suggestion ?? null;

  const point = s?.location ?? null;
  const { editing } = usePointEditing({ point, editable: false, reticle: false });
  const focus = useMemo(() => (point ? { lngLat: point, zoom: 18 } : null), [point]);

  if (!s) {
    return (
      <Page title="Suggestion" back={back}>
        {detail.state.status === 'error' ? (
          <ErrorNotice
            error={detail.state.error}
            title="Could not load this suggestion"
            onReload={detail.state.error.kind === 'not-found' ? undefined : detail.reload}
          />
        ) : (
          <div className="flex justify-center py-8">
            <Spinner label="Loading the suggestion…" />
          </div>
        )}
      </Page>
    );
  }

  const done = (record: SuggestionRecord, message: string) => {
    setOpen(null);
    detail.setData((d) => (d ? { ...d, suggestion: record } : d!));
    detail.reload();
    toast.show({ message, tone: 'success' });
  };
  const dialogProps = { suggestion: s, onClose: () => setOpen(null), onDone: done, onReload: detail.reload };
  const actions = moderationActions(s.status);
  const duplicates = detail.state.data?.possibleDuplicates ?? [];
  const history = detail.state.data?.history ?? [];

  return (
    <Page
      title={s.name}
      back={back}
      wide
      description={
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone={SUGGESTION_STATUS_TONES[s.status]}>{SUGGESTION_STATUS_LABELS[s.status]}</Badge>
          <span>
            Submitted {formatDateTime(s.createdAt)} · revision {s.revision}
          </span>
        </span>
      }
      actions={
        approving ? null : (
          <>
            {actions.map((a) =>
              a === 'approve' ? (
                <Button key={a} variant="primary" icon="check" onClick={() => setApproving(true)}>
                  {ACTION_LABELS[a]}
                </Button>
              ) : (
                <Button key={a} onClick={() => setOpen({ kind: a })}>
                  {ACTION_LABELS[a]}
                </Button>
              ),
            )}
          </>
        )
      }
    >
      {detail.state.status === 'error' ? (
        <ErrorNotice
          error={detail.state.error}
          title="Could not refresh this suggestion"
          onReload={detail.reload}
        />
      ) : null}

      {s.status === 'approved' && s.publishedLocationId ? (
        <p className="rounded-md border border-border bg-success-soft p-3 text-sm text-text">
          Approved and published as{' '}
          <a
            className={cx('font-medium text-accent-text underline', FOCUS_RING)}
            href={adminHref({ section: 'locations', id: s.publishedLocationId })}
            onClick={onInAppClick(() => navigate({ section: 'locations', id: s.publishedLocationId }))}
          >
            {s.publishedLocationId}
          </a>
          . Hide or edit it in Locations.
        </p>
      ) : null}

      {approving ? (
        <ApprovePanel
          key={`${s.id}:${s.revision}`}
          suggestion={s}
          campus={campus}
          onCancel={() => setApproving(false)}
          onReload={detail.reload}
          onApproved={(r) => {
            setApproving(false);
            detail.setData((d) => (d ? { ...d, suggestion: r.suggestion } : d!));
            detail.reload();
            toast.show({ message: `Approved and published as ${r.location.id}.`, tone: 'success' });
          }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Section title="Submitted">
            <Facts
              items={[
                ['Category', categoryLabel(s.categoryId)],
                ['Position', formatLngLat(s.location)],
                ['Description', s.description],
                ['Landmark', s.landmark],
                [
                  'Evidence link',
                  s.evidenceUrl ? (
                    <span className="flex flex-col">
                      <a
                        className={cx('break-all text-accent-text underline', FOCUS_RING)}
                        href={s.evidenceUrl}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                      >
                        {s.evidenceUrl}
                      </a>
                      <span className="text-xs text-muted">
                        External link supplied by the submitter; unverified.
                      </span>
                    </span>
                  ) : null,
                ],
                ['Other details', s.details],
              ]}
            />
          </Section>
          <MapPanel
            campus={campus}
            editing={editing}
            focus={focus}
            label="Map: submitted position"
            className="h-64 rounded-lg border border-border lg:h-auto lg:min-h-64"
          />
          <Section title="Review">
            <Facts
              items={[
                ['Reviewed by', s.reviewedBy],
                ['Reviewed at', s.reviewedAt ? formatDateTime(s.reviewedAt) : null],
                ['Private note', s.reviewNote],
                ['Duplicate of', s.duplicateOf],
              ]}
            />
          </Section>
          <Section title="Possible duplicates">
            {duplicates.length === 0 ? (
              <p className="text-sm text-muted">
                The server found no existing place, location or suggestion with a similar name nearby.
              </p>
            ) : (
              <ul className="flex flex-col gap-2" aria-label="Possible duplicates">
                {duplicates.map((d) => (
                  <li
                    key={`${d.kind}:${d.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2"
                  >
                    <div className="min-w-0">
                      <p className="font-medium break-words text-text">{d.name}</p>
                      <p className="text-sm text-muted">
                        {KIND_LABEL[d.kind]} · {d.reason}
                      </p>
                      <p className="text-xs break-all text-subtle">{d.id}</p>
                    </div>
                    {actions.includes('duplicate') ? (
                      <Button size="sm" onClick={() => setOpen({ kind: 'duplicate', target: d.id })}>
                        Duplicate of this…
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}

      <Section title="History">
        {history.length === 0 ? (
          <EmptyState icon="history" title="No recorded events" />
        ) : (
          <AuditEventList events={history} navigate={navigate} compact />
        )}
      </Section>

      {open?.kind === 'reject' ? <RejectDialog {...dialogProps} /> : null}
      {open?.kind === 'request-info' ? <RequestInfoDialog {...dialogProps} /> : null}
      {open?.kind === 'duplicate' ? (
        <DuplicateDialog {...dialogProps} initialTarget={open.target ?? ''} />
      ) : null}
      {open?.kind === 'reopen' ? <ReopenDialog {...dialogProps} /> : null}
      {open?.kind === 'edit' ? <EditSuggestionDialog {...dialogProps} /> : null}
    </Page>
  );
}
