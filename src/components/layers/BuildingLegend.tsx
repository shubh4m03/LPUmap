import { buildingLegend } from '../../buildings3d/index.ts';

/** Building colour key; colours come from the map palette so they match what is drawn. */
export function BuildingLegend({ theme }: { theme: 'light' | 'dark' }) {
  const entries = buildingLegend(theme);
  return (
    <section aria-labelledby="layers-legend" className="flex flex-col gap-3 border-t border-border pt-4">
      <h3 id="layers-legend" className="text-sm font-semibold text-muted">
        Building heights
      </h3>
      <ul className="flex flex-col gap-3">
        {entries.map((e) => (
          <li key={e.heightSource} className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="mt-0.5 inline-block size-5 shrink-0 rounded-sm border border-border-strong"
              style={{ backgroundColor: e.color }}
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
