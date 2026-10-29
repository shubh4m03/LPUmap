import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AtlasContext } from '../../../src/app/data/atlas-context.ts';
import { datasetAge, datasetAgeWarning } from '../../../src/app/data/dataset-age.ts';
import { buildServices } from '../../../src/app/data/services.ts';
import { resetDatasetAgeNotice, useDatasetAgeNotice } from '../../../src/app/hooks/useDatasetAgeNotice.ts';
import { AboutPanel } from '../../../src/components/about/AboutPanel.tsx';
import { ToastProvider } from '../../../src/components/ui/index.ts';
import { APP_CONFIG } from '../../../src/config/index.ts';
import { renderWithAtlas, resetAppStore } from './render-helpers.tsx';
import { syntheticCampus } from './synthetic-campus.ts';

// G-18: a dated warning when the dataset's sources are older than APP_CONFIG.cache.datasetStaleDays.
const RETRIEVED = '2026-01-10T09:00:00Z';
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => Date.parse(RETRIEVED) + days * DAY;
const LIMIT = APP_CONFIG.cache.datasetStaleDays;

function servicesRetrievedAt(builtFrom: string) {
  const data = syntheticCampus();
  data.manifest.builtFrom = builtFrom;
  return buildServices(data);
}

describe('datasetAge', () => {
  it('is stale only past the configured number of days, and never negative', () => {
    expect(datasetAge(RETRIEVED, at(LIMIT))).toMatchObject({ days: LIMIT, stale: false });
    expect(datasetAge(RETRIEVED, at(LIMIT + 1))).toMatchObject({ days: LIMIT + 1, stale: true });
    expect(datasetAge(RETRIEVED, at(-3))).toMatchObject({ days: 0, stale: false });
    expect(datasetAge(RETRIEVED, at(10), 5)?.stale).toBe(true);
  });

  it('has no age (and so no warning) for a missing or unreadable date', () => {
    expect(datasetAge(undefined, at(999))).toBeNull();
    expect(datasetAge('not a date', at(999))).toBeNull();
    expect(datasetAgeWarning(null)).toBeNull();
  });

  it('states the retrieval date and the age, and says the data MAY have changed', () => {
    const text = datasetAgeWarning(datasetAge(RETRIEVED, at(200)));
    expect(text).toBe(
      'The campus data was retrieved on 10 Jan 2026, 200 days ago. Buildings, paths and places may have changed since. Check on site before relying on it.',
    );
    expect(datasetAgeWarning(datasetAge(RETRIEVED, at(5)))).toBeNull();
  });
});

describe('dataset age in the UI', () => {
  beforeEach(() => {
    resetAppStore();
    resetDatasetAgeNotice();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at(LIMIT + 30));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 404 })),
    );
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('About shows the warning for an old dataset, and nothing for a fresh one', () => {
    renderWithAtlas(<AboutPanel />, servicesRetrievedAt(RETRIEVED));
    expect(screen.getByRole('note')).toHaveTextContent(`${LIMIT + 30} days ago`);
    cleanup();
    renderWithAtlas(<AboutPanel />, servicesRetrievedAt(new Date(at(LIMIT)).toISOString()));
    expect(screen.queryByText(/days ago/)).not.toBeInTheDocument();
  });

  it('warns once at start-up when the dataset is old', async () => {
    function Probe() {
      useDatasetAgeNotice();
      return null;
    }
    const services = servicesRetrievedAt(RETRIEVED);
    const ui = () => (
      <ToastProvider>
        <AtlasContext.Provider value={services}>
          <Probe />
        </AtlasContext.Provider>
      </ToastProvider>
    );
    const { unmount } = render(ui());
    expect(await screen.findByText(/The campus data was retrieved on 10 Jan 2026/)).toBeInTheDocument();
    unmount();
    render(ui());
    expect(screen.queryByText(/The campus data was retrieved/)).not.toBeInTheDocument();
  });
});
