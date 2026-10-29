import { selectDirectoryItem } from '../../app/artwork-selection.ts';
import { useAtlas } from '../../app/data/atlas-context.ts';
import { useAppStore } from '../../app/store/index.ts';
import type { Place } from '../../data/index.ts';
import type { DirectoryEntry } from '../../directory/index.ts';
import { ARTWORK_STATUS } from '../directory/directory-view-model.ts';
import { Badge, Button } from '../ui/index.ts';
import { EvidenceList, PrintedLabels, PrintedText, Vignettes } from './ArtworkDetails.tsx';
import { ARTWORK_NUMBER_NOTE_TEXT, showOnIllustration, useOnIllustration } from './artwork-format.ts';
import { DetailSection } from './DetailSection.tsx';
import { verifiedOfficialName } from '../../directory/index.ts';

/**
 * Identity of a building (docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md §0 rule 3):
 * the stable id, and an official name or block number only when a verified
 * source records it. Never filled from the illustration.
 */
export function PlaceIdentity({ place, entry }: { place: Place; entry: DirectoryEntry | undefined }) {
  const { sourceName } = useAtlas();
  const officialName = verifiedOfficialName(place);
  return (
    <DetailSection title="Identity" icon="info">
      <ul className="space-y-0.5 text-sm text-muted">
        <li>
          Official block number:{' '}
          {entry?.officialBlock ? (
            <>
              <span className="text-text">{entry.officialBlock.label}</span> (source:{' '}
              {sourceName(entry.officialBlock.sourceId)})
            </>
          ) : (
            'none recorded'
          )}
        </li>
        <li>
          Official name:{' '}
          {officialName !== null ? (
            <>
              <span className="text-text">{officialName}</span> (verified, source:{' '}
              {sourceName(place.provenance.sourceId)})
            </>
          ) : (
            'not verified'
          )}
        </li>
        <li>
          Stable id: <code className="font-mono text-text">{place.id}</code>
        </li>
      </ul>
    </DetailSection>
  );
}

/**
 * How the campus illustration shows this building: its VERIFIED items (exact
 * printed labels, the status and evidence), and approximate items that name it
 * as their candidate ("Unconfirmed match": a pointer to that item, never this
 * building's label).
 */
export function PlaceArtwork({ entry }: { entry: DirectoryEntry }) {
  const { buildingDirectory, artwork } = useAtlas();
  const listMode = useAppStore((s) => s.listMode);
  const onIllustration = useOnIllustration();
  const art = buildingDirectory.artwork;
  if (!art || (entry.artwork.length === 0 && entry.unconfirmedArtwork.length === 0)) return null;
  const hasHotspots = entry.artwork.some((l) => l.hotspotIds.length > 0);
  const thumbnails = entry.artwork.flatMap((l) => art.thumbnailsOf(l.subjectId));
  const verified = ARTWORK_STATUS.verified;
  const unconfirmed = ARTWORK_STATUS.unconfirmed;

  return (
    <>
      <DetailSection title="On the campus illustration" icon="overview">
        {entry.artwork.map((l) => {
          const n = art.subjects.get(l.subjectId)?.artworkNumber ?? null;
          const evidence = artwork.associations.get(l.subjectId)?.evidence ?? [];
          return (
            <div key={l.subjectId} className="mb-2 flex flex-col gap-1">
              <span title={verified.description} className="inline-flex">
                <Badge tone={verified.tone}>{verified.label}</Badge>
              </span>
              <PrintedLabels labels={l.labels} numberNote={ARTWORK_NUMBER_NOTE_TEXT} />
              {n !== null && !l.labels.some((x) => x.role === 'visible-block') ? (
                <p className="text-sm text-muted">
                  Number <PrintedText text={n} /> on the illustration. {ARTWORK_NUMBER_NOTE_TEXT}
                </p>
              ) : null}
              <EvidenceList evidence={evidence} />
              <p className="text-xs text-muted">
                Illustration item id: <code className="font-mono">{l.subjectId}</code>
              </p>
            </div>
          );
        })}
        {entry.unconfirmedArtwork.length > 0 ? (
          <div className="flex flex-col gap-1.5 rounded-md bg-warning-soft p-3 text-sm text-text">
            <p>
              <strong className="font-semibold">{unconfirmed.label}.</strong> The illustration may show this
              building, but it has not been confirmed on site or by an official source:
            </p>
            <ul className="flex flex-col gap-1">
              {entry.unconfirmedArtwork.map((p) => {
                const item = art.subjectTarget.get(p.subjectId);
                return (
                  <li key={p.subjectId}>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="overview"
                      onClick={() => (item ? selectDirectoryItem(item) : undefined)}
                    >
                      {p.title}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        {hasHotspots && !listMode && !onIllustration && artwork.unavailableReason === null ? (
          <div className="mt-2">
            <Button size="sm" variant="secondary" icon="overview" onClick={showOnIllustration}>
              Show on the illustration
            </Button>
          </div>
        ) : null}
      </DetailSection>
      <Vignettes thumbnails={thumbnails} title={entry.title} />
    </>
  );
}
