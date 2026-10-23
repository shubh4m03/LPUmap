/**
 * About & data sources: what the app is, where its data comes from (licences
 * and attribution), coverage figures taken from manifest.counts, known
 * limitations and how to help. Opens via `openPanel('about')`; uses
 * `openReport({})` from the app store.
 */
import type { JSX } from 'react';
import { useAtlas } from '../../app/data/atlas-context.ts';
import { useAppStore } from '../../app/store/index.ts';
import { APP_CONFIG } from '../../config/index.ts';
import { formatDate, ExternalLink } from '../place/index.ts';
import { FactList, PanelSection } from '../settings/PanelSection.tsx';
import { Button } from '../ui/index.ts';
import { OSM_CONTRIBUTE_URL, count, coverageFacts, fmt, placeStats } from './about-model.ts';
import { QualitySummary } from './QualitySummary.tsx';
import { SourcesSection } from './SourcesSection.tsx';

export function AboutPanel(): JSX.Element {
  const { data } = useAtlas();
  const openReport = useAppStore((s) => s.openReport);
  const m = data.manifest;
  const stats = placeStats(data.places);
  const unnamed = count(m, 'buildings:unnamed');
  const buildings = count(m, 'buildings');
  const components = count(m, 'graph:components');

  return (
    <div className="flex flex-col gap-6 p-4">
      <PanelSection title={APP_CONFIG.brand.name} icon="info">
        <p className="text-sm">
          {APP_CONFIG.brand.description} It is an independent project, not an official{' '}
          {APP_CONFIG.brand.institution} service, and it shows no live information.
        </p>
        <FactList
          label="Dataset"
          items={[
            ['Dataset version', m.datasetVersion],
            ['Sources retrieved', formatDate(m.builtFrom) ?? 'Not recorded'],
          ]}
        />
      </PanelSection>

      <SourcesSection manifest={m} />

      <PanelSection title="What the data covers" icon="layers">
        <FactList label="Coverage" items={coverageFacts(m).map((f) => [f.label, f.value])} />
      </PanelSection>

      <PanelSection title="Known limitations" icon="warning">
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">
          <li>
            Most campus buildings have no name in the data
            {unnamed !== null && buildings !== null ? ` (${fmt(unnamed)} of ${fmt(buildings)} outlines)` : ''}
            . They are shown as “Unnamed building”, never with a guessed name.
          </li>
          <li>No indoor maps or indoor routing. Routes follow mapped outdoor paths only.</li>
          <li>
            The walking network
            {components !== null ? ` has ${fmt(components)} separate parts` : ' is incomplete'}, so some
            routes report that no path is mapped.
          </li>
          <li>
            {stats.withWheelchair === 0
              ? 'Accessibility is unrecorded: no record states whether it is wheelchair accessible.'
              : `Accessibility is mostly unrecorded: ${fmt(stats.withWheelchair)} of ${fmt(stats.total)} records state wheelchair access.`}
          </li>
          <li>
            {stats.withHours === 0
              ? 'No record has published opening hours, so whether a place is open is unknown.'
              : `Opening hours are rarely published: ${fmt(stats.withHours)} of ${fmt(stats.total)} records have them, and they may be out of date.`}
          </li>
          <li>
            {stats.withHours === 0
              ? 'No live data: no crowding, menus, bus times, events or open/closed status.'
              : 'No live data: no crowding, menus, bus times, events or open/closed status beyond published hours.'}
          </li>
          <li>
            {stats.verified === 0
              ? 'No record has a dated on-the-ground check yet; all come as published by their sources.'
              : `${fmt(stats.verified)} of ${fmt(stats.total)} records have been checked on the ground.`}
          </li>
        </ul>
      </PanelSection>

      <QualitySummary />

      <PanelSection title="How to help" icon="flag">
        <p className="text-sm text-muted">
          Spotted something wrong or missing? Prepare a correction report, or add the information to
          OpenStreetMap so every map that uses it improves.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" icon="flag" onClick={() => openReport({})}>
            Report a correction
          </Button>
          <ExternalLink href={OSM_CONTRIBUTE_URL}>Contribute to OpenStreetMap</ExternalLink>
        </div>
      </PanelSection>
    </div>
  );
}
