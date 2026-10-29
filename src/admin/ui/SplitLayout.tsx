import type { ReactNode } from 'react';
import { cx } from '../../components/ui/index.ts';

/**
 * Map editor layout: a scrollable panel beside a full-height map on wide
 * screens (≥ 1024 px); stacked on narrower ones, with the map first when it
 * is the placement tool (`mapFirst`).
 */
export function SplitLayout({
  panel,
  map,
  mapFirst = false,
}: {
  panel: ReactNode;
  map: ReactNode;
  mapFirst?: boolean;
}) {
  return (
    <div className="flex min-h-full flex-col lg:grid lg:h-full lg:min-h-0 lg:grid-cols-[minmax(22rem,28rem)_1fr]">
      <div
        className={cx(
          'flex min-w-0 flex-col gap-4 p-4 lg:order-none lg:min-h-0 lg:overflow-y-auto lg:border-e lg:border-border',
          mapFirst ? 'order-2' : 'order-1',
        )}
      >
        {panel}
      </div>
      <div className={cx('h-72 shrink-0 sm:h-96 lg:order-none lg:h-full', mapFirst ? 'order-1' : 'order-2')}>
        {map}
      </div>
    </div>
  );
}
