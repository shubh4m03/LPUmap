import { useId } from 'react';
import { Badge, Button, IconButton } from '../../components/ui/index.ts';
import { ASSOCIATION_BADGE } from './art-ui.ts';
import type { ArtModel, ArtSubjectView } from '../index.ts';
import { artworkUrl } from '../index.ts';
import { ARTWORK_NUMBER_NOTE, type LabelQuote } from '../index.ts';

/** What the card may say about a linked map building (only ever shown for a VERIFIED link). */
export interface LinkedBuildingInfo {
  /** The building's name on the map (may be "Unnamed building · …"): never presented as official. */
  mapName: string;
  /** Only a name verified against a cited official source (verifiedOfficialName), else null. */
  officialName: string | null;
  /** Only a block label cited to an official source, never an artwork number. */
  officialBlockLabel: string | null;
}

export interface ArtworkDetailCardProps {
  model: ArtModel;
  subjectId: string;
  compact?: boolean;
  onClose(): void;
  onSelectSubject(subjectId: string): void;
  /** Verified only. */
  onShowOnMap(buildingId: string): void;
  /** Verified only. */
  onDirections(buildingId: string): void;
  /** Approximate only: frame the candidate on the map, never select or route to it. */
  onShowUnconfirmedMatch(buildingId: string): void;
  linkedBuilding(buildingId: string): LinkedBuildingInfo | null;
}

const ROLE_TEXT = {
  display: 'Caption',
  'visible-block': 'Block heading as printed',
  other: 'Also printed as',
  category: 'Index section',
} as const;

function labelRows(s: ArtSubjectView): { role: keyof typeof ROLE_TEXT; q: LabelQuote }[] {
  const subj = s.subject;
  if (subj.displayHold) return [];
  const rows: { role: keyof typeof ROLE_TEXT; q: LabelQuote }[] = [];
  if (subj.displayLabel) rows.push({ role: 'display', q: subj.displayLabel });
  if (subj.visibleBlockLabel) rows.push({ role: 'visible-block', q: subj.visibleBlockLabel });
  for (const q of subj.otherLabels) rows.push({ role: 'other', q });
  if (subj.artworkCategory) rows.push({ role: 'category', q: subj.artworkCategory });
  return rows;
}

/**
 * Detail card of the selected illustration item: the exact artwork labels, the
 * artwork's number with its "not an official block number" note, the original
 * vignette file(s) (unchanged pixels, linked to the file), the SEPARATE
 * official fields (empty unless the link is verified), the association status,
 * and actions that depend on it.
 */
export function ArtworkDetailCard(props: ArtworkDetailCardProps) {
  const { model, subjectId, compact = false } = props;
  const headingId = useId();
  const sv = model.bySubject.get(subjectId);
  if (!sv) return null;
  const { subject, association } = sv;
  const held = subject.displayHold !== null;
  const badge = ASSOCIATION_BADGE[association.status];
  const verifiedBuilding =
    association.status === 'verified' && association.buildingId !== null
      ? props.linkedBuilding(association.buildingId)
      : null;
  const unconfirmed =
    association.status === 'approximate' && association.unconfirmedMatchId !== null
      ? association.unconfirmedMatchId
      : null;
  const hotspots = sv.hotspotIds.map((id) => model.byHotspot.get(id)).filter((h) => h !== undefined);
  const needsReview = hotspots.some((h) => h.needsReview);
  const rows = labelRows(sv);
  const related = subject.relations
    .map((r) => ({ r, view: model.bySubject.get(r.subjectId) }))
    .filter((x) => x.view !== undefined);

  return (
    <section
      aria-labelledby={headingId}
      data-testid="art-detail-card"
      className="pointer-events-auto flex max-h-full w-full max-w-sm flex-col overflow-hidden rounded-lg border border-border bg-surface-raised text-sm text-text shadow-2"
    >
      <div className="flex items-start gap-2 py-2 pr-1 pl-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">On the illustration</p>
          {/* pre-wrap: printed double spaces ('CAMPUS CAFE  &') stay visible, as everywhere else. */}
          <h2
            id={headingId}
            className="font-semibold break-words whitespace-pre-wrap"
            data-testid="art-detail-title"
          >
            {sv.title}
          </h2>
        </div>
        <IconButton icon="close" label="Close" size="sm" onClick={props.onClose} />
      </div>
      <div className="flex flex-col gap-3 overflow-y-auto px-3 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span title={badge.detail} className="inline-flex" data-testid="art-association-badge">
            <Badge tone={badge.tone}>{badge.label}</Badge>
          </span>
          {needsReview ? (
            <Badge tone="neutral" icon="warning">
              Outline needs review
            </Badge>
          ) : null}
        </div>

        {subject.artworkNumber !== null ? (
          <p>
            <span className="font-medium">Pin {subject.artworkNumber}</span>{' '}
            <span className="text-muted">— {ARTWORK_NUMBER_NOTE}</span>
          </p>
        ) : null}

        {held ? (
          <p className="text-muted">
            The printed label of this item is withheld until the site owner has reviewed it.
          </p>
        ) : rows.length > 0 ? (
          <dl className="flex flex-col gap-1" aria-label="Artwork labels, exactly as printed">
            {rows.map(({ role, q }) => (
              <div key={`${role}:${q.ref}:${q.text}`} className="flex flex-col">
                <dt className="text-xs text-muted">{ROLE_TEXT[role]}</dt>
                <dd className="font-medium break-words whitespace-pre-wrap" data-testid="art-exact-label">
                  {q.text}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-muted">Nothing is printed on the illustration for this outline.</p>
        )}

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1" aria-label="Official details">
          {verifiedBuilding ? (
            <>
              <dt className="text-muted">Map building</dt>
              <dd data-testid="art-map-building">{verifiedBuilding.mapName}</dd>
            </>
          ) : null}
          <dt className="text-muted">Official name</dt>
          <dd data-testid="art-official-name">{verifiedBuilding?.officialName ?? 'Not verified'}</dd>
          <dt className="text-muted">Official block</dt>
          <dd data-testid="art-official-block">
            {verifiedBuilding ? (verifiedBuilding.officialBlockLabel ?? 'Not recorded') : 'Not verified'}
          </dd>
        </dl>

        <p className="text-muted">{badge.detail}</p>

        {association.status === 'verified' && association.buildingId !== null ? (
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="primary"
              size="sm"
              icon="route"
              onClick={() => props.onDirections(association.buildingId!)}
            >
              Directions
            </Button>
            <Button size="sm" icon="pin" onClick={() => props.onShowOnMap(association.buildingId!)}>
              Show on map
            </Button>
          </div>
        ) : unconfirmed ? (
          <Button size="sm" icon="pin" onClick={() => props.onShowUnconfirmedMatch(unconfirmed)}>
            Show unconfirmed match on map
          </Button>
        ) : null}

        {subject.vignetteAssetIds.map((assetId) => {
          const asset = model.assets.get(assetId);
          const original = asset?.original;
          if (!asset || !original) return null;
          const fileName = original.url.split('/').pop() ?? original.url;
          if (held)
            return (
              <p key={assetId} className="text-muted">
                Its vignette is withheld until the site owner has reviewed it.
              </p>
            );
          const captions = asset.labels.map((l) => l.text).join(' / ');
          return (
            <figure key={assetId} className="flex flex-col gap-1">
              <img
                src={artworkUrl(original.url)}
                alt={`Original vignette of the illustration${captions ? `, printed: ${captions}` : ''}`}
                width={asset.source.width}
                height={asset.source.height}
                loading="lazy"
                decoding="async"
                className="h-auto w-full rounded-md border border-border"
                data-testid="art-vignette"
                data-asset-id={assetId}
              />
              <figcaption className="text-xs text-muted">
                Original artwork, unchanged.{' '}
                <a
                  className="text-accent-text underline"
                  href={artworkUrl(original.url)}
                  target="_blank"
                  rel="noopener"
                >
                  Open the original file ({fileName})
                </a>
              </figcaption>
            </figure>
          );
        })}

        {related.length > 0 && !compact ? (
          <div>
            <h3 className="text-xs font-semibold text-muted">
              Possibly related (unverified: drawn alike or grouped, not confirmed)
            </h3>
            <ul className="mt-1 flex flex-col gap-1">
              {related.map(({ r, view }) => (
                <li key={r.subjectId}>
                  <button
                    type="button"
                    className="text-left whitespace-pre-wrap text-accent-text underline"
                    onClick={() => props.onSelectSubject(r.subjectId)}
                  >
                    {view!.title}
                  </button>{' '}
                  <span className="text-xs text-muted">
                    {r.relation === 'candidate-part-of' ? '(may be part of it)' : '(looks similar)'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
