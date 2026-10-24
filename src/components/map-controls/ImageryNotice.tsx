import { Fragment, type CSSProperties, type ReactNode } from 'react';
import type { LngLat } from '../../data/schema.ts';
import { imageryDateLine } from '../../map/providers/attribution.ts';
import type { ImageryProvider } from '../../map/providers/types.ts';
import { cx } from '../ui/cx.ts';

/** Keeps ISO dates on one line ("2026-10-24" must never break at a hyphen). */
function withUnbrokenDates(text: string): ReactNode {
  return text.split(/(\d{4}-\d{2}-\d{2})/).map((part, i) =>
    /^\d{4}-\d{2}-\d{2}$/.test(part) ? (
      <span key={i} className="whitespace-nowrap">
        {part}
      </span>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/**
 * What the imagery under the map is (docs/IMAGERY_COVERAGE_AND_FRESHNESS.md §5):
 * provider and "not live"; the required "Powered by …" text; a low-detail
 * warning that must stay visible (EOX: "10 m imagery — buildings not
 * visible"); and the capture date only where it was verified, never a guess.
 * Text nodes only. The full source credits stay in MapLibre's attribution
 * control, which lists the imagery source whenever its tiles are drawn.
 *
 * `compact` (phones): the date/caption line folds into a disclosure so the
 * notice does not cover the map; the first line and any warning stay visible.
 */
export function ImageryNotice({
  provider,
  center,
  compact = false,
  className,
  style,
}: {
  provider: ImageryProvider;
  /** The view centre (the capture date is shown only inside its verified area). */
  center: LngLat | null;
  compact?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const detail = imageryDateLine(provider, center) ?? provider.caption;
  const heading = (
    <>
      <span className="font-semibold">{provider.label}</span>
      <span className="text-muted"> · not live</span>
      {provider.attribution.requiredLogoText ? (
        <span className="text-muted"> · {provider.attribution.requiredLogoText}</span>
      ) : null}
    </>
  );
  const warning = provider.notice ? (
    <p data-testid="imagery-warning" className="font-semibold text-text">
      {provider.notice}
    </p>
  ) : null;
  return (
    <section
      aria-label="About the satellite imagery"
      data-testid="imagery-notice"
      style={style}
      className={cx(
        'rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-xs leading-snug text-text shadow-2',
        className,
      )}
    >
      {compact ? (
        <details>
          <summary className="cursor-pointer marker:text-muted">{heading}</summary>
          <p className="text-muted">{withUnbrokenDates(detail)}</p>
        </details>
      ) : (
        <>
          <p>{heading}</p>
          <p className="text-muted">{withUnbrokenDates(detail)}</p>
        </>
      )}
      {warning}
    </section>
  );
}
