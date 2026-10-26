/**
 * Read-only link from a Building Studio record to the campus-illustration
 * items linked to it (its own `stu:` id, or the base building it models).
 * Building Studio stays separate: this panel only READS the artwork links
 * and opens the Artwork section; it never writes an association, a studio
 * record or an image file.
 */
import { useMemo, useState } from 'react';
import { cx, FOCUS_RING } from '../../../components/ui/cx.ts';
import { Spinner } from '../../../components/ui/Spinner.tsx';
import { useAdminApi } from '../../context.ts';
import { useResource } from '../../hooks/useResource.ts';
import { navigateAdmin } from '../../router.ts';
import { adminHref } from '../../routes.ts';
import { onInAppClick } from '../../ui/links.ts';
import { PanelSection } from '../../studio/controls.tsx';
import { useStudioState } from '../../studio/studio-context.ts';
import { linksForBuildings } from './artwork-model.ts';
import { StatusBadge } from './StatusBadge.tsx';

export function ArtworkLinksList({ buildingIds }: { buildingIds: readonly string[] }) {
  const api = useAdminApi();
  const list = useResource('artwork-associations', (signal) => api.artwork.listAssociations({ signal }));
  const key = buildingIds.join('|');
  const links = useMemo(
    () => linksForBuildings(list.state.data?.items ?? [], key ? key.split('|') : []),
    [list.state.data, key],
  );
  if (buildingIds.length === 0) return <p className="text-sm text-muted">Save the record first.</p>;
  if (list.state.status === 'loading' && !list.state.data) return <Spinner label="Loading artwork links…" />;
  if (list.state.status === 'error')
    return (
      <p className="text-sm text-muted">Artwork links could not be loaded ({list.state.error.message}).</p>
    );
  if (links.length === 0)
    return <p className="text-sm text-muted">No campus-illustration item is linked to this building.</p>;
  return (
    <ul className="flex flex-col gap-1" aria-label="Linked illustration items">
      {links.map((l) => (
        <li key={l.subjectId} className="flex flex-wrap items-center gap-2">
          <a
            href={adminHref({ section: 'artwork', id: l.subjectId })}
            onClick={onInAppClick(() => navigateAdmin({ section: 'artwork', id: l.subjectId }))}
            className={cx('text-sm font-medium text-accent-text underline', FOCUS_RING)}
          >
            <code>{l.subjectId}</code>
          </a>
          <StatusBadge status={l.effective.status} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Inspector panel of the open studio record. Collapsed by default, and the
 * association list is requested only once the owner opens it, so the Studio
 * never waits on (or fails with) the artwork endpoints.
 */
export function StudioArtworkSection() {
  const recordId = useStudioState((s) => s.editor.head?.id ?? null);
  const targetId = useStudioState((s) => s.editor.targetId);
  const ids = useMemo(() => [recordId, targetId].filter((x): x is string => !!x), [recordId, targetId]);
  const [opened, setOpened] = useState(false);
  return (
    <PanelSection
      title="Campus illustration"
      id="studio-section-artwork"
      defaultOpen={false}
      onToggle={(open) => {
        if (open) setOpened(true);
      }}
    >
      <p className="text-xs text-muted">
        Read-only. Links are set in Admin → Artwork with evidence; the Studio never changes artwork files.
      </p>
      {opened ? <ArtworkLinksList buildingIds={ids} /> : null}
    </PanelSection>
  );
}
