import { HEIGHT_NOTES, isoBuildingTitle } from './info.ts';
import { spokenMapKey } from './labels.ts';
import type { IsoBuilding } from './scene.ts';

/**
 * Compact info panel of the selected building in the overview. Owner-authored
 * models carry the S3 labels ("Illustrative model placed by the site owner —
 * not verified", "appearance only"); the full record stays in the details panel.
 */
export function IsoInfoCard({ building, compact = false }: { building: IsoBuilding; compact?: boolean }) {
  const title = isoBuildingTitle(building);
  return (
    <section
      aria-label="Selected building"
      className="pointer-events-auto max-w-80 rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text shadow-2"
    >
      <h2 className="truncate font-semibold">{title}</h2>
      <dl className="mt-1 flex flex-col gap-0.5 text-muted">
        {building.key ? (
          <div className="flex gap-1">
            <dt className="sr-only">Map key</dt>
            <dd>
              <span aria-hidden="true">Map key {building.key}</span>
              <span className="sr-only">{spokenMapKey(building.key)}</span>
              <span> (this app&apos;s reference, not an official block number)</span>
            </dd>
          </div>
        ) : null}
        {building.name === null && building.key && !compact ? (
          <div>
            <dt className="sr-only">Source label</dt>
            <dd>{building.displayName}</dd>
          </div>
        ) : null}
        {building.studio ? (
          <>
            <div>
              <dt className="sr-only">Model</dt>
              <dd className="font-medium text-text">{building.studio.verificationLabel}</dd>
            </div>
            <div>
              <dt className="sr-only">Appearance</dt>
              <dd>{building.studio.appearanceLabel}</dd>
            </div>
            {building.studio.fallback ? (
              <div>
                <dt className="sr-only">Model status</dt>
                <dd>Model unavailable in this version: drawn as a plain block.</dd>
              </div>
            ) : null}
          </>
        ) : compact ? null : (
          <div>
            <dt className="sr-only">Height</dt>
            <dd>{HEIGHT_NOTES[building.heightSource]}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
