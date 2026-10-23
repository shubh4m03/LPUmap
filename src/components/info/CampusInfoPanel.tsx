/**
 * Campus information (student workflows): the academic directory from the
 * curated organisation records, and an honest status for mess menus,
 * transport, events and faculty, none of which has a reliable public source
 * (see docs/research/LPU_PUBLIC_SOURCES.md). Opens via `openPanel('info')`;
 * uses `openCategory(id)` and `openPanel('about')` from the app store.
 */
import type { JSX } from 'react';
import { useAppStore } from '../../app/store/index.ts';
import { APP_CONFIG } from '../../config/index.ts';
import { safeExternalUrl } from '../../utils/safe-url.ts';
import { ExternalLink, formatDate } from '../place/index.ts';
import { Button } from '../ui/index.ts';
import { AcademicDirectory } from './AcademicDirectory.tsx';
import { RESEARCH_DATE, UNAVAILABLE_SERVICES } from './info-sources.ts';
import { UnavailableSection } from './UnavailableSection.tsx';

export function CampusInfoPanel(): JSX.Element {
  const openPanel = useAppStore((s) => s.openPanel);
  const site = safeExternalUrl(APP_CONFIG.brand.officialSite);

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex flex-col gap-2 text-sm">
        <p>
          <span className="font-semibold">{APP_CONFIG.brand.institution}</span>, {APP_CONFIG.brand.location}.
          This app is not an official university service. For anything time-sensitive, check with the
          university.
        </p>
        {site ? <ExternalLink href={site}>Official university website</ExternalLink> : null}
      </div>

      <AcademicDirectory />

      {UNAVAILABLE_SERVICES.map((s) => (
        <UnavailableSection key={s.id} service={s} />
      ))}

      <div className="flex flex-col gap-2 border-t border-border pt-4 text-sm text-muted">
        <p>
          Official sources were last reviewed on {formatDate(RESEARCH_DATE) ?? RESEARCH_DATE}. If LPU
          publishes any of this as open data, it can be added.
        </p>
        <Button variant="secondary" icon="info" className="self-start" onClick={() => openPanel('about')}>
          Data sources and coverage
        </Button>
      </div>
    </div>
  );
}
