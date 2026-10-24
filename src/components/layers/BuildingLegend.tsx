import { buildingLegend, type BuildingLegendOptions } from '../../buildings3d/index.ts';

/**
 * Building colour key; colours come from the map palette so they match what is drawn.
 * The owner-placed-model and detected-footprint classes appear only while they are drawn.
 */
export function BuildingLegend({ theme, ...opts }: { theme: 'light' | 'dark' } & BuildingLegendOptions) {
  const entries = buildingLegend(theme, opts);
  return (
    <section aria-labelledby="layers-legend" className="flex flex-col gap-3 border-t border-border pt-4">
      <h3 id="layers-legend" className="text-sm font-semibold text-muted">
        Building heights
      </h3>
      <ul className="flex flex-col gap-3">
        {entries.map((e) => (
          <li key={e.key} className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="mt-0.5 inline-block size-5 shrink-0 rounded-sm border border-border-strong"
              style={
                e.swatch === 'dashed'
                  ? { border: `2px dashed ${e.color}`, backgroundColor: 'transparent' }
                  : { backgroundColor: e.color }
              }
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-text">{e.label}</span>
              <span className="block text-sm text-muted">{e.description}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
