import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAtlas } from '../../../src/app/data/atlas-context.ts';
import { DataProvider } from '../../../src/app/data/DataProvider.tsx';
import { loadPublication, type PublicationLoad } from '../../../src/app/data/publication.ts';
import { useAppStore } from '../../../src/app/store/index.ts';
import { EMPTY_PUBLICATION } from '../../../src/community/schema.ts';
import { DatasetError, loadCampusData } from '../../../src/data/index.ts';
import type * as DataModule from '../../../src/data/index.ts';
import type * as PublicationModule from '../../../src/app/data/publication.ts';
import { syntheticCampus } from './synthetic-campus.ts';

vi.mock('../../../src/data/index.ts', async (orig) => {
  const actual = await orig<typeof DataModule>();
  return { ...actual, loadCampusData: vi.fn() };
});

vi.mock('../../../src/app/data/publication.ts', async (orig) => ({
  ...(await orig<typeof PublicationModule>()),
  loadPublication: vi.fn(),
}));

const load = vi.mocked(loadCampusData);
const loadPub = vi.mocked(loadPublication);
const ABSENT: PublicationLoad = { status: { kind: 'unavailable' }, publication: null };

function Probe() {
  const { data, categoryCounts, router, publication, getPlace } = useAtlas();
  return (
    <p>
      ready {data.manifest.datasetVersion} food={categoryCounts['food']} nodes={router.nodeCount} pub=
      {publication.kind} kiosk={getPlace('own:kiosk')?.campusZone ?? 'none'}
    </p>
  );
}

const ui = (
  <DataProvider>
    <Probe />
  </DataProvider>
);

describe('DataProvider', () => {
  beforeEach(() => {
    load.mockReset();
    loadPub.mockReset();
    loadPub.mockResolvedValue(ABSENT);
    useAppStore.setState({ showNearbyOutsideCampus: false });
  });
  afterEach(cleanup);

  it('shows an accessible loading screen, then provides derived services', async () => {
    let resolve!: (v: ReturnType<typeof syntheticCampus>) => void;
    load.mockReturnValue(new Promise((r) => (resolve = r)));
    render(ui);
    expect(screen.getByRole('status')).toHaveTextContent('Loading campus data');
    expect(screen.getByRole('heading', { name: 'LPU Campus Atlas' })).toBeInTheDocument();
    resolve(syntheticCampus());
    expect(await screen.findByText(/ready synthetic-001 food=2 nodes=3/)).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('without an API (static hosting) the base dataset loads with no error', async () => {
    load.mockResolvedValue(syntheticCampus());
    render(ui);
    expect(await screen.findByText(/ready synthetic-001 .* pub=unavailable kiosk=none/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('applies the publication; off-campus results appear only while the nearby layer is on', async () => {
    load.mockResolvedValue(syntheticCampus());
    const publication = {
      ...EMPTY_PUBLICATION,
      publicationVersion: 3,
      generatedAt: '2026-10-24T05:00:00.000Z',
      locations: [
        {
          id: 'own:kiosk',
          origin: 'owner' as const,
          name: 'Synthetic Kiosk',
          categoryId: 'food',
          location: [75.6, 31.1] as [number, number],
          wheelchair: 'unknown' as const,
          verificationStatus: 'unverified' as const,
          accessNodeId: null,
          revision: 1,
          updatedAt: '2026-10-24T05:00:00.000Z',
        },
      ],
    };
    loadPub.mockResolvedValue({
      status: { kind: 'live', publicationVersion: 3, generatedAt: publication.generatedAt, buildings: 0 },
      publication,
    });
    render(ui);
    // The synthetic campus has no boundary polygon, so the published location is off campus (rule 4a).
    expect(await screen.findByText(/pub=live kiosk=none/)).toBeInTheDocument();
    act(() => useAppStore.setState({ showNearbyOutsideCampus: true }));
    expect(await screen.findByText(/kiosk=off-campus-nearby/)).toBeInTheDocument();
    act(() => useAppStore.setState({ showNearbyOutsideCampus: false }));
    expect(await screen.findByText(/kiosk=none/)).toBeInTheDocument();
  });

  it('shows a network error with a working retry', async () => {
    load
      .mockRejectedValueOnce(new DatasetError('network', 'offline'))
      .mockResolvedValueOnce(syntheticCampus());
    render(ui);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be downloaded');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/ready synthetic-001/)).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('explains invalid data', async () => {
    load.mockRejectedValueOnce(new DatasetError('invalid', 'bad'));
    render(ui);
    expect(await screen.findByRole('alert')).toHaveTextContent('failed its integrity check');
  });

  it('asks for a reload on a schema-version mismatch', async () => {
    load.mockRejectedValueOnce(new DatasetError('schema-version', 'v2'));
    render(ui);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('A newer data format is available — reload');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('treats unknown failures as a retryable error', async () => {
    load.mockRejectedValueOnce(new Error('boom'));
    render(ui);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
  });
});
