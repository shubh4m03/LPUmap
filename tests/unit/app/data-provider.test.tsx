import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAtlas } from '../../../src/app/data/atlas-context.ts';
import { DataProvider } from '../../../src/app/data/DataProvider.tsx';
import { DatasetError, loadCampusData } from '../../../src/data/index.ts';
import type * as DataModule from '../../../src/data/index.ts';
import { syntheticCampus } from './synthetic-campus.ts';

vi.mock('../../../src/data/index.ts', async (orig) => {
  const actual = await orig<typeof DataModule>();
  return { ...actual, loadCampusData: vi.fn() };
});

const load = vi.mocked(loadCampusData);

function Probe() {
  const { data, categoryCounts, router } = useAtlas();
  return (
    <p>
      ready {data.manifest.datasetVersion} food={categoryCounts['food']} nodes={router.nodeCount}
    </p>
  );
}

const ui = (
  <DataProvider>
    <Probe />
  </DataProvider>
);

describe('DataProvider', () => {
  beforeEach(() => load.mockReset());
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
