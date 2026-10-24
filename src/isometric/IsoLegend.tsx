import { useId, useState } from 'react';
import { IconButton } from '../components/ui/index.ts';
import type { IsoThemeColors } from './iso-theme.ts';

/**
 * Collapsible legend of the overview (§2.1, §6.5): ground roles, building
 * tones, and the data-honesty notes (estimated vs placeholder heights,
 * illustrative owner models, "Map key ≠ official block number").
 */
export function IsoLegend({ colors, hasStudioModels }: { colors: IsoThemeColors; hasStudioModels: boolean }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const swatch = (fill: string, label: string, opts: { dashed?: boolean; edge?: string } = {}) => (
    <li className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="inline-block size-4 shrink-0 rounded-sm border"
        style={{
          background: fill,
          borderColor: opts.edge ?? 'var(--ds-border-strong)',
          borderStyle: opts.dashed ? 'dashed' : 'solid',
        }}
      />
      <span>{label}</span>
    </li>
  );
  return (
    <section
      aria-label="Overview legend"
      className="pointer-events-auto max-w-72 rounded-lg border border-border bg-surface-raised text-sm text-text shadow-2"
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
      <div id={bodyId} hidden={!open} className="max-h-[50vh] overflow-y-auto px-3 pb-3">
        <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
          {swatch(colors.campusGround, 'Campus ground')}
          {swatch(colors.surroundings, 'Outside campus')}
          {swatch(colors.green, 'Green space')}
          {swatch(colors.pitch, 'Sports pitch')}
          {swatch(colors.roadBand, 'Road')}
          {swatch(colors.path, 'Footpath')}
          {swatch(colors.parking, 'Parking')}
          {swatch(colors.water, 'Water')}
        </ul>
        <ul className="mt-2 flex flex-col gap-1">
          {swatch(colors.building.wallLit, 'Building, height estimated from its floor count', {
            edge: colors.building.edge,
          })}
          {swatch(colors.placeholder.roof, 'Pale with dashed roof: placeholder height (no height data)', {
            dashed: true,
            edge: colors.placeholder.edge,
          })}
          {hasStudioModels
            ? swatch(
                colors.glass,
                'Detailed shape: illustrative model placed by the site owner, not verified',
              )
            : null}
        </ul>
        <p className="mt-2 flex items-start gap-2">
          <span
            aria-hidden="true"
            className="mt-1 inline-block size-3 shrink-0 rotate-45 border-2"
            style={{ background: colors.keyMarkerFill, borderColor: colors.keyMarkerStroke }}
          />
          <span>
            <strong className="font-semibold">Map key</strong> (for example C4-07): the grid cell and a number
            within it. Map keys are this app&apos;s own references. They are not official LPU block numbers.
          </span>
        </p>
        <p className="mt-2 text-muted">
          Heights are drawn to scale from estimates, not measurements. Only mapped buildings are shown; many
          campus structures are not mapped yet.
        </p>
      </div>
    </section>
  );
}
