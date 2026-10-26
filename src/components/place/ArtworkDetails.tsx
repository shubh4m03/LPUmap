import { useAtlas } from '../../app/data/atlas-context.ts';
import { useAppStore } from '../../app/store/index.ts';
import type { ArtworkThumbnail } from '../../directory/index.ts';
import type { ArtworkLabelView, ArtworkOnlyEntry } from '../../isometric-art/directory.ts';
import type { AssociationEvidence } from '../../isometric-art/schema.ts';
import { ARTWORK_STATUS, artworkStatusOf } from '../directory/directory-view-model.ts';
import { ArtworkNumberGlyph } from '../directory/MapKeyGlyph.tsx';
import { Badge, Button, Icon } from '../ui/index.ts';
import { DetailSection, ExternalLink } from './DetailSection.tsx';
import {
  ARTWORK_LABEL_ROLES,
  EVIDENCE_KIND_LABELS,
  frameCandidate,
  NO_OFFICIAL_IDENTITY,
  showOnIllustration,
  useOnIllustration,
} from './artwork-format.ts';
import { formatDate } from './place-format.ts';

/** Printed text, exactly: internal double spaces are kept (never trimmed or corrected). */
export function PrintedText({ text }: { text: string }) {
  return <span className="font-medium whitespace-pre-wrap text-text">{text}</span>;
}

/** The exact printed labels, introduced by their role; the artwork number note beside any block heading. */
export function PrintedLabels({
  labels,
  numberNote,
}: {
  labels: readonly ArtworkLabelView[];
  numberNote: string | null;
}) {
  return (
    <dl className="space-y-1 text-sm">
      {labels.map((l) => (
        <div key={`${l.role}:${l.ref}:${l.text}`} className="flex flex-wrap gap-x-1.5">
          <dt className="text-muted">{ARTWORK_LABEL_ROLES[l.role]}:</dt>
          <dd>
            <PrintedText text={l.text} />
            {l.role === 'visible-block' && numberNote ? (
              <span className="block text-xs text-muted">{numberNote}</span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function EvidenceList({ evidence }: { evidence: readonly AssociationEvidence[] }) {
  if (evidence.length === 0) return null;
  return (
    <ul className="mt-1.5 space-y-1 text-sm text-text">
      {evidence.map((ev, i) => (
        <li key={i}>
          <span className="font-medium">{EVIDENCE_KIND_LABELS[ev.kind]}</span> (
          {formatDate(ev.date) ?? ev.date}): {ev.description}
          {ev.url ? (
            <>
              {' '}
              <ExternalLink href={ev.url}>Source</ExternalLink>
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** The vignettes, whole and unchanged (scaled to fit), each linking to the original file. */
export function Vignettes({ thumbnails, title }: { thumbnails: readonly ArtworkThumbnail[]; title: string }) {
  if (thumbnails.length === 0) return null;
  return (
    <DetailSection title="Vignettes of the illustration" icon="overview">
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {thumbnails.map((t) => (
          <li key={t.assetId}>
            <a
              href={t.src}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-md border border-border focus-visible:outline-2 focus-visible:outline-(--ds-focus-ring)"
            >
              <img
                src={t.src}
                width={t.width}
                height={t.height}
                loading="lazy"
                decoding="async"
                alt={`Illustration vignette showing ${title}`}
                className="h-auto w-full rounded-md bg-surface-sunken object-contain"
              />
              <span className="sr-only">(opens the original image in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    </DetailSection>
  );
}

/**
 * Details of an item of the campus illustration that is NOT linked to a
 * verified map building (docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md §5): its
 * exact printed labels, that no official name or number is recorded, its
 * stable id, its association status and evidence, and its vignettes. It has
 * no map position and is never routed to; an approximate one names its
 * candidate building only as "Unconfirmed match".
 */
export function ArtworkDetails({ entry: e }: { entry: ArtworkOnlyEntry }) {
  const { buildingDirectory, artwork } = useAtlas();
  const onIllustration = useOnIllustration();
  const listMode = useAppStore((s) => s.listMode);
  const status = ARTWORK_STATUS[artworkStatusOf(e)];
  const candidate = e.unconfirmedMatch
    ? buildingDirectory.byId.get(e.unconfirmedMatch.buildingId)
    : undefined;
  const thumbnails = buildingDirectory.artwork?.thumbnailsOf(e.id) ?? [];
  const subject = buildingDirectory.artwork?.subjects.get(e.id);
  const canShowOnIllustration =
    !listMode && !onIllustration && artwork.unavailableReason === null && e.hotspotIds.length > 0;
  const aliases = e.aliases.filter((a) => !e.labels.some((l) => l.text === a));

  return (
    <article className="flex flex-col gap-4 p-4" aria-label={e.title}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center">
          {e.artworkNumber ? (
            <ArtworkNumberGlyph artworkNumber={e.artworkNumber} />
          ) : (
            <Icon name="overview" size={22} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h3
            data-panel-focus
            className="text-lg leading-tight font-semibold break-words whitespace-pre-wrap"
          >
            {e.title}
          </h3>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge tone="accent" icon="overview">
              Campus illustration
            </Badge>
            <span title={status.description} className="inline-flex">
              <Badge tone={status.tone}>{status.label}</Badge>
            </span>
          </div>
        </div>
      </div>

      <p className="rounded-md bg-surface-sunken p-3 text-sm text-muted">{e.subtitle}.</p>

      {canShowOnIllustration ? (
        <div>
          <Button size="sm" variant="secondary" icon="overview" onClick={showOnIllustration}>
            Show on the illustration
          </Button>
        </div>
      ) : null}

      <DetailSection title="Printed on the illustration" icon="overview">
        {e.labelWithheld ? (
          <p className="text-sm text-muted">The printed label is withheld until the owner has reviewed it.</p>
        ) : e.labels.length > 0 ? (
          <PrintedLabels labels={e.labels} numberNote={e.artworkNumberNote} />
        ) : (
          <p className="text-sm text-muted">Nothing is printed on this part of the illustration.</p>
        )}
        {e.artworkNumber && !e.labels.some((l) => l.role === 'visible-block') ? (
          <p className="mt-1 text-sm text-muted">
            Number <PrintedText text={e.artworkNumber} /> on the illustration. {e.artworkNumberNote}
          </p>
        ) : null}
        {aliases.length > 0 ? (
          <p className="mt-1 text-sm text-muted">
            Also found by searching: {aliases.join(', ')} (search spellings only; the printed text above is
            kept exactly).
          </p>
        ) : null}
      </DetailSection>

      <DetailSection title="Official name and block number" icon="info">
        <p className="text-sm text-muted">{NO_OFFICIAL_IDENTITY}</p>
      </DetailSection>

      <DetailSection title="Link to the map" icon="pin">
        <p className="text-sm text-text">{status.description}</p>
        {candidate ? (
          <div className="mt-2 flex flex-col gap-2 rounded-md bg-warning-soft p-3 text-sm text-text">
            <p>
              <strong className="font-semibold">{status.label}:</strong> {candidate.title}
              {candidate.key && !candidate.title.includes(candidate.key) ? ` (map key ${candidate.key})` : ''}
              . It is not selected, not used for directions and not shown as this item’s location.
            </p>
            {!listMode && useAppStore.getState().mapUnavailable === null ? (
              <div>
                <Button size="sm" variant="secondary" icon="pin" onClick={() => frameCandidate(candidate)}>
                  Show the candidate on the map
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
        {e.association.reason ? <p className="mt-1.5 text-sm text-muted">{e.association.reason}</p> : null}
        <EvidenceList evidence={e.association.evidence} />
        <p className="mt-1.5 flex gap-2 text-sm text-muted">
          <Icon name="warning" className="mt-0.5 shrink-0 text-warning" />
          <span>{e.routableNote}</span>
        </p>
      </DetailSection>

      <Vignettes thumbnails={thumbnails} title={e.title} />

      <DetailSection title="Identity" icon="info">
        <ul className="space-y-0.5 text-sm text-muted">
          <li>
            Stable id: <code className="font-mono text-text">{e.id}</code>
          </li>
          {subject && subject.needsManualVerification.length > 0 ? (
            <li>
              <details>
                <summary className="cursor-pointer">
                  {subject.needsManualVerification.length} review{' '}
                  {subject.needsManualVerification.length === 1 ? 'note' : 'notes'} for the owner
                </summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {subject.needsManualVerification.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </details>
            </li>
          ) : null}
        </ul>
      </DetailSection>
    </article>
  );
}
