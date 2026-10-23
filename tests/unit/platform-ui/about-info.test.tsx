import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildServices } from '../../../src/app/data/services.ts';
import { useAppStore } from '../../../src/app/store/index.ts';
import { AboutPanel } from '../../../src/components/about/AboutPanel.tsx';
import { CampusInfoPanel } from '../../../src/components/info/CampusInfoPanel.tsx';
import type { CampusData } from '../../../src/data/index.ts';
import { renderWithAtlas } from '../app/render-helpers.tsx';
import { syntheticCampus } from '../app/synthetic-campus.ts';
import { resetPlatformState } from './helpers.ts';

/** Synthetic manifest with deliberately odd counts, so the UI can only show them by reading them. */
function campusWithCounts(): CampusData {
  const data = syntheticCampus();
  data.manifest.counts = {
    buildings: 4321,
    'buildings:unnamed': 4111,
    places: 9876,
    'zone:on-campus': 1234,
    'zone:off-campus-nearby': 8642,
    'places:withoutLocation': 77,
    'places:notConnected': 55,
    'graph:nodes': 3333,
    'graph:edges': 4444,
    'graph:components': 13,
  };
  data.manifest.sources = [
    {
      id: 'osm',
      name: 'OpenStreetMap',
      url: 'https://api.openstreetmap.org/api/0.6/map?bbox=1,2,3,4',
      license: 'ODbL 1.0',
      attribution: '© OpenStreetMap contributors',
      retrievedAt: '2026-10-01T00:00:00Z',
    },
    {
      id: 'curated:page-a',
      name: 'Lovely Professional University — Synthetic School Page',
      url: 'https://www.lpu.in/schools/synthetic/',
      retrievedAt: '2026-10-02',
    },
    { id: 'curated:bad', name: 'Unsafe page', url: 'javascript:alert(1)' },
  ];
  return data;
}

const QUALITY = {
  importantCategories: [
    { id: 'water', label: 'Drinking water', total: 0, onCampus: 0, status: 'empty' },
    { id: 'health', label: 'Health & emergency', total: 2, onCampus: 1, status: 'sparse' },
    { id: 'food', label: 'Food & drink', total: 50, onCampus: 20, status: 'ok' },
  ],
};

describe('AboutPanel', () => {
  beforeEach(() => {
    resetPlatformState();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(QUALITY), { status: 200 })),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('takes every coverage number from the manifest', () => {
    renderWithAtlas(<AboutPanel />, buildServices(campusWithCounts()));
    const coverage = screen.getByLabelText('Coverage');
    expect(coverage).toHaveTextContent('Building outlines4,321 (4,111 without a name)');
    expect(coverage).toHaveTextContent('Places and records9,876');
    expect(coverage).toHaveTextContent('On campus1,234');
    expect(coverage).toHaveTextContent('Off campus (nearby)8,642');
    expect(coverage).toHaveTextContent('Without a map position77');
    expect(coverage).toHaveTextContent('3,333 points, 4,444 segments, 13 separate parts');
    expect(screen.getByText(/\(4,111 of 4,321 outlines\)/)).toBeInTheDocument();
    expect(screen.getByText(/has 13 separate parts/)).toBeInTheDocument();
    expect(screen.getByLabelText('Dataset')).toHaveTextContent('Dataset versionsynthetic-001');
  });

  it('shows "not recorded" rather than inventing a missing count', () => {
    renderWithAtlas(<AboutPanel />); // synthetic manifest has no counts
    expect(screen.getByLabelText('Coverage')).toHaveTextContent('Building outlinesnot recorded');
  });

  it('derives the hours and accessibility limitations from the places', () => {
    renderWithAtlas(<AboutPanel />);
    // Synthetic campus: 6 places, 3 with opening hours, none with wheelchair info.
    expect(screen.getByText(/3 of 6 records have them/)).toBeInTheDocument();
    expect(screen.getByText(/Accessibility is unrecorded: no record states/)).toBeInTheDocument();
  });

  it('does not mention published hours in the live-data limitation when none are published', () => {
    const data = syntheticCampus();
    for (const p of data.places) delete p.openingHours;
    renderWithAtlas(<AboutPanel />, buildServices(data));
    expect(screen.getByText(/No record has published opening hours/)).toBeInTheDocument();
    expect(screen.getByText(/^No live data:/)).not.toHaveTextContent('published hours');
  });

  it('attributes OpenStreetMap with the copyright link and lists only safe curated links', async () => {
    const user = userEvent.setup();
    renderWithAtlas(<AboutPanel />, buildServices(campusWithCounts()));
    expect(screen.getByRole('link', { name: /© OpenStreetMap contributors/ })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/copyright',
    );
    await user.click(screen.getByText('Official LPU web pages cited (1)'));
    const page = screen.getByRole('link', { name: /Synthetic School Page/ });
    expect(page).toHaveAttribute('href', 'https://www.lpu.in/schools/synthetic/');
    expect(page).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByRole('link', { name: /Unsafe page/ })).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it('summarises thin categories from the lazily fetched quality report', async () => {
    renderWithAtlas(<AboutPanel />);
    expect(await screen.findByText('Drinking water')).toBeInTheDocument();
    expect(screen.getByText('None mapped')).toBeInTheDocument();
    expect(screen.getByText('2 total, 1 on campus')).toBeInTheDocument();
    expect(screen.queryByText('Food & drink')).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/data/quality-report.json', expect.anything());
  });

  it('reports a failed quality report instead of hiding it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 404 })),
    );
    renderWithAtlas(<AboutPanel />);
    expect(await screen.findByText(/could not be loaded \(HTTP 404\)/)).toBeInTheDocument();
  });

  it('offers the correction dialog', async () => {
    const user = userEvent.setup();
    renderWithAtlas(<AboutPanel />);
    await user.click(screen.getByRole('button', { name: 'Report a correction' }));
    expect(useAppStore.getState().reportTarget).toEqual({});
  });
});

describe('CampusInfoPanel', () => {
  beforeEach(resetPlatformState);
  afterEach(cleanup);

  it('lists organisation records from the data, with honest position status', () => {
    renderWithAtlas(<CampusInfoPanel />);
    const directory = screen.getByRole('region', { name: 'Academic directory' });
    expect(within(directory).getByText('Synthetic Library')).toBeInTheDocument();
    expect(within(directory).getByText('Library & study (1)')).toBeInTheDocument();
    expect(within(directory).getByText('No verified map position')).toBeInTheDocument();
    expect(within(directory).getByRole('link', { name: /Official page/ })).toHaveAttribute(
      'href',
      'https://example.org/library',
    );
    // Non-organisation places are not part of the directory.
    expect(within(directory).queryByText('Synthetic Food Point')).not.toBeInTheDocument();
    expect(within(directory).getByText(/0 of 1 are placed on the map/)).toBeInTheDocument();
  });

  it('heads academic organisation records as schools, not buildings', () => {
    const data = syntheticCampus();
    const org = data.places.find((p) => p.kind === 'organization');
    if (!org) throw new Error('synthetic campus has no organisation record');
    org.categoryId = 'academic';
    renderWithAtlas(<CampusInfoPanel />, buildServices(data));
    const directory = screen.getByRole('region', { name: 'Academic directory' });
    expect(within(directory).getByText('Schools and disciplines (1)')).toBeInTheDocument();
    expect(within(directory).queryByText(/Academic building/)).not.toBeInTheDocument();
    expect(within(directory).getByText(/no official campus map was found/)).toBeInTheDocument();
  });

  it('marks mess, transport, events and faculty as not available, linking official pages', () => {
    renderWithAtlas(<CampusInfoPanel />);
    for (const title of [
      'Mess & food menus',
      'Transport & shuttle',
      'Events & announcements',
      'Faculty directory',
    ]) {
      const section = screen.getByRole('region', { name: title });
      expect(within(section).getByText('Not available')).toBeInTheDocument();
      expect(within(section).getByText(/No official public data source we can rely on/)).toBeInTheDocument();
      for (const link of within(section).getAllByRole('link')) {
        expect(link.getAttribute('href')).toMatch(/^https:\/\/(www\.lpu\.in|happenings\.lpu\.in)\//);
      }
    }
    expect(screen.getByRole('link', { name: /Official university website/ })).toHaveAttribute(
      'href',
      'https://www.lpu.in/',
    );
  });

  it('offers a category shortcut only when the data has records for it', async () => {
    const user = userEvent.setup();
    renderWithAtlas(<CampusInfoPanel />);
    // Synthetic data: 2 located food places, no transport places.
    expect(screen.queryByRole('button', { name: /Show mapped transport stops/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show mapped food places (2)' }));
    expect(useAppStore.getState().categoryId).toBe('food');
  });
});
