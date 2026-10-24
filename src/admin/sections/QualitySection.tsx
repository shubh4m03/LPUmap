/**
 * Data quality: the server's warnings (orphans with their reason, invalid
 * access points, locations outside the boundary or not routable, possible
 * duplicates, stale pending suggestions) and the overview counts. Each
 * warning links to the record to fix.
 */
import { Badge } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { cx, FOCUS_RING } from '../../components/ui/cx.ts';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { Spinner } from '../../components/ui/Spinner.tsx';
import { QUALITY_WARNING_KINDS, type Overview, type QualityWarning } from '../api/schemas.ts';
import { useAdminApi } from '../context.ts';
import { useResource } from '../hooks/useResource.ts';
import type { AdminRouteTarget } from '../router.ts';
import { adminHref } from '../routes.ts';
import { ErrorNotice } from '../ui/ErrorNotice.tsx';
import {
  ORPHAN_REASON_ADVICE,
  ORPHAN_REASON_LABELS,
  QUALITY_KIND_LABELS,
  SUGGESTION_STATUS_LABELS,
} from '../ui/format.ts';
import { Facts, Page, Section } from '../ui/Page.tsx';
import { onInAppClick } from '../ui/links.ts';
import type { AdminSectionProps } from './types.ts';

function warningRoute(w: QualityWarning): AdminRouteTarget {
  if (w.entityType === 'override') return { section: 'overrides', id: w.id };
  if (w.entityType === 'location') return { section: 'locations', id: w.id };
  return { section: 'queue', id: w.id };
}

export default function QualitySection({ navigate }: AdminSectionProps) {
  const api = useAdminApi();
  const quality = useResource('quality', (signal) => api.community.quality({ signal }));
  const overview = useResource('overview', (signal) => api.community.overview({ signal }));
  const reload = () => {
    quality.reload();
    overview.reload();
  };
  const warnings = quality.state.data?.warnings ?? [];

  return (
    <Page
      title="Quality"
      description="Checks the server runs over the published data and the queue. Nothing here is fixed automatically."
      wide
      actions={
        <Button size="sm" icon="reset" onClick={reload} loading={quality.state.status === 'loading'}>
          Refresh
        </Button>
      }
    >
      {overview.state.data ? <OverviewCard o={overview.state.data} /> : null}
      {overview.state.status === 'error' ? (
        <ErrorNotice
          error={overview.state.error}
          title="Could not load the overview"
          onReload={overview.reload}
        />
      ) : null}
      {quality.state.status === 'error' ? (
        <ErrorNotice
          error={quality.state.error}
          title="Could not load the quality checks"
          onReload={quality.reload}
        />
      ) : null}
      {quality.state.status === 'loading' && !quality.state.data ? (
        <Spinner label="Running the quality checks…" />
      ) : quality.state.data && warnings.length === 0 ? (
        <EmptyState icon="check" title="No warnings" description="Every check passed." />
      ) : quality.state.data ? (
        QUALITY_WARNING_KINDS.filter((k) => warnings.some((w) => w.kind === k)).map((kind) => {
          const group = warnings.filter((w) => w.kind === kind);
          return (
            <Section key={kind} title={`${QUALITY_KIND_LABELS[kind]} (${group.length})`}>
              <ul className="flex flex-col gap-2">
                {group.map((w) => {
                  const to = warningRoute(w);
                  return (
                    <li
                      key={`${w.kind}:${w.id}:${w.relatedId ?? ''}`}
                      className="flex flex-col gap-1 rounded-md border border-border p-3 text-sm"
                    >
                      <p className="text-text">{w.message}</p>
                      {w.orphanReason ? (
                        <p className="flex flex-col gap-1 text-muted">
                          <Badge tone="warning" className="w-fit">
                            {ORPHAN_REASON_LABELS[w.orphanReason]}
                          </Badge>
                          {ORPHAN_REASON_ADVICE[w.orphanReason]}
                        </p>
                      ) : null}
                      <p className="flex flex-wrap gap-x-3">
                        <a
                          href={adminHref(to)}
                          onClick={onInAppClick(() => navigate(to))}
                          className={cx('break-all text-accent-text underline', FOCUS_RING)}
                        >
                          Open {w.id}
                        </a>
                        {w.relatedId ? (
                          <span className="break-all text-muted">Related: {w.relatedId}</span>
                        ) : null}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </Section>
          );
        })
      ) : null}
    </Page>
  );
}

function OverviewCard({ o }: { o: Overview }) {
  const s = o.suggestions;
  return (
    <Section title="Overview">
      <Facts
        items={[
          [
            'Suggestions',
            (Object.keys(SUGGESTION_STATUS_LABELS) as Array<keyof typeof SUGGESTION_STATUS_LABELS>)
              .map((k) => `${SUGGESTION_STATUS_LABELS[k]} ${s[k] ?? 0}`)
              .join(' · '),
          ],
          [
            'Locations',
            `Owner: ${o.locations.owner.active} published, ${o.locations.owner.hidden} hidden · Community: ${o.locations.community.active} published, ${o.locations.community.hidden} hidden`,
          ],
          [
            'Overrides',
            `${o.overrides.total} total · ${o.overrides.hidden} hidden · ${o.overrides.withFields} with field changes · ${o.overrides.withAccessPoint} with an access point · ${o.overrides.orphan} orphaned`,
          ],
          ['History (7 days)', `${o.auditLast7Days} events`],
          ['Publication version', String(o.publicationVersion)],
          ['Base dataset version', o.datasetVersion],
        ]}
      />
    </Section>
  );
}
