import { useAtlas } from '../../app/data/atlas-context.ts';
import type { Place } from '../../data/index.ts';
import { VerificationBadge } from '../ui/index.ts';
import { DetailSection, ExternalLink } from './DetailSection.tsx';
import { formatDate, sourceRefUrl } from './place-format.ts';

/** Where this record comes from and how far it has been checked. */
export function PlaceProvenance({ place }: { place: Place }) {
  const { sourceName } = useAtlas();
  const prov = place.provenance;
  const refUrl = sourceRefUrl(prov);
  const isOsm = prov.sourceId === 'osm';
  const retrieved = formatDate(prov.retrievedAt);
  const verified = formatDate(prov.lastVerifiedAt);

  return (
    <DetailSection title="Source" icon="info">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <VerificationBadge status={prov.verificationStatus} />
        <span className="text-text">{sourceName(prov.sourceId)}</span>
      </div>
      <ul className="mt-1.5 space-y-0.5 text-sm text-muted">
        {refUrl ? (
          <li>
            <ExternalLink href={refUrl}>
              {isOsm ? 'View this record on OpenStreetMap' : 'View source page'}
            </ExternalLink>
          </li>
        ) : null}
        {retrieved ? <li>Data retrieved {retrieved}</li> : <li>Retrieval date not recorded</li>}
        {verified ? <li>Last verified {verified}</li> : <li>Not independently verified on site</li>}
        {prov.notes ? <li>{prov.notes}</li> : null}
      </ul>
    </DetailSection>
  );
}
