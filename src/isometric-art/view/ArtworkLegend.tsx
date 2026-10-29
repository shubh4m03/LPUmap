import { useId, useState } from 'react';
import { IconButton } from '../../components/ui/index.ts';
import { LEGEND_CROP } from './art-ui.ts';
import type { ArtSourceSpace } from '../index.ts';

export interface ArtworkLegendProps {
  /** Manifest-relative URL already resolved to an app URL (the image the overview shows). */
  imageUrl: string;
  space: ArtSourceSpace;
  /** Legend labels exactly as printed (inventory, e.g. 'PEDISTRIAN'). */
  labels: readonly string[];
  /** CSS width of the crop. */
  width?: number;
}

/** The artwork's own legend (original crop) behind a toggle, with its exact labels for screen readers. */
export function ArtworkLegend({ imageUrl, space, labels, width = 240 }: ArtworkLegendProps) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const k = width / LEGEND_CROP.width;
  return (
    <section
      aria-label="Illustration legend"
      className="pointer-events-auto max-w-72 rounded-lg border border-border bg-surface-raised text-sm text-text shadow-2"
      data-testid="art-legend"
    >
      <div className="flex items-center justify-between gap-2 py-1 pr-1 pl-3">
        <h2 className="text-sm font-semibold">Legend</h2>
        <IconButton
          icon={open ? 'chevron-down' : 'chevron-up'}
          label={open ? 'Hide legend' : 'Show legend'}
          size="sm"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
        />
      </div>
      <div id={bodyId} hidden={!open} className="px-3 pb-3">
        <div
          role="img"
          aria-label={`Legend printed on the illustration: ${labels.join(', ')}.`}
          className="relative overflow-hidden rounded-md border border-border"
          style={{ width, height: Math.round(LEGEND_CROP.height * k) }}
        >
          {open ? (
            <img
              src={imageUrl}
              alt=""
              draggable={false}
              className="absolute max-w-none"
              style={{
                left: -LEGEND_CROP.x * k,
                top: -LEGEND_CROP.y * k,
                width: space.width * k,
                height: space.height * k,
              }}
              data-testid="art-legend-crop"
            />
          ) : null}
        </div>
        <p className="mt-2 text-xs text-muted">Cropped from the original illustration.</p>
        <p className="mt-1 text-xs text-muted">
          Clickable outlines are drawn on hover, focus and selection. A dashed outline in “Show outlines” has
          not been checked by hand yet.
        </p>
      </div>
    </section>
  );
}
