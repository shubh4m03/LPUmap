import type { Manifest } from '../../data/index.ts';
import { ExternalLink, formatDate } from '../place/index.ts';
import { PanelSection } from '../settings/PanelSection.tsx';
import { Icon } from '../ui/index.ts';
import { OSM_ATTRIBUTION, OSM_COPYRIGHT_URL, groupSources, shortUrl } from './about-model.ts';

/** Data sources and licences, straight from manifest.sources. */
export function SourcesSection({ manifest }: { manifest: Manifest }) {
  const { osm, pages, other } = groupSources(manifest.sources);
  return (
    <PanelSection title="Data sources and licences" icon="globe">
      {osm ? (
        <div className="flex flex-col gap-1 text-sm">
          <p className="font-medium">{osm.name}</p>
          <p>
            <ExternalLink href={OSM_COPYRIGHT_URL}>{OSM_ATTRIBUTION}</ExternalLink>
          </p>
          <p className="text-muted">
            Map geometry, building outlines, paths and most place names. Licensed under the Open Database
            License ({osm.license ?? 'ODbL'}).
            {osm.retrievedAt ? ` Retrieved ${formatDate(osm.retrievedAt) ?? osm.retrievedAt}.` : ''}
          </p>
        </div>
      ) : null}

      {pages.length > 0 ? (
        <details className="group text-sm">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md font-medium focus-visible:outline-2 focus-visible:outline-focus">
            <Icon
              name="chevron-right"
              size={16}
              className="transition-transform duration-fast group-open:rotate-90 motion-reduce:transition-none"
            />
            Official LPU web pages cited ({pages.length})
          </summary>
          <p className="mt-1 text-muted">
            Only school and facility names are taken from these pages, as short factual identifiers. Their
            content is © Lovely Professional University and is not copied. Records from them have no verified
            map position unless stated.
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {pages.map((p) => (
              <li key={p.id} className="flex flex-col">
                <ExternalLink href={p.url}>{p.title}</ExternalLink>
                <span className="text-xs text-muted">
                  {shortUrl(p.url)}
                  {p.retrievedAt ? ` · retrieved ${formatDate(p.retrievedAt) ?? p.retrievedAt}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {other.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm">
          {other.map((s) => (
            <li key={s.id}>
              <span className="font-medium">{s.name}</span>
              {s.license ? <span className="text-muted"> · {s.license}</span> : null}
              {s.attribution ? <span className="block text-muted">{s.attribution}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </PanelSection>
  );
}
