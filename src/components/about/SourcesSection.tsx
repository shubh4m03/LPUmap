import type { Manifest } from '../../data/index.ts';
import { safeExternalUrl } from '../../utils/safe-url.ts';
import { ExternalLink, formatDate } from '../place/index.ts';
import { PanelSection } from '../settings/PanelSection.tsx';
import { Icon } from '../ui/index.ts';
import { OSM_ATTRIBUTION, OSM_COPYRIGHT_URL, groupSources, shortUrl } from './about-model.ts';

/**
 * A shipped licence text (manifest `licenseTextPath`, relative to the app root), or null when the path
 * is not a plain relative file path. Resolved against the deployment base so it works under a sub-path.
 */
function shippedLicenceHref(path: string | undefined, base: string): string | null {
  if (!path || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(path) || path.split('/').includes('..')) return null;
  return `${base.endsWith('/') ? base : `${base}/`}${path}`;
}

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
          {other.map((s) => {
            const sourceUrl = safeExternalUrl(s.url);
            const licenceUrl = safeExternalUrl(s.licenseUrl);
            const licenceText = shippedLicenceHref(s.licenseTextPath, import.meta.env.BASE_URL);
            return (
              <li key={s.id} className="flex flex-col gap-0.5">
                <span className="font-medium">
                  {sourceUrl ? <ExternalLink href={sourceUrl}>{s.name}</ExternalLink> : s.name}
                </span>
                {s.license ? (
                  <span className="text-muted">
                    Licence:{' '}
                    {licenceUrl ? <ExternalLink href={licenceUrl}>{s.license}</ExternalLink> : s.license}
                    {licenceText ? (
                      <>
                        {' · '}
                        <a
                          href={licenceText}
                          className="text-accent-text underline underline-offset-2 hover:no-underline"
                        >
                          Full licence text
                        </a>
                      </>
                    ) : null}
                  </span>
                ) : null}
                {s.attribution ? <span className="text-muted">{s.attribution}</span> : null}
                {s.retrievedAt ? (
                  <span className="text-xs text-muted">
                    Retrieved {formatDate(s.retrievedAt) ?? s.retrievedAt}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </PanelSection>
  );
}
