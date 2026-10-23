import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../../src/app/store/index.ts';
import { PlaceDetails } from '../../../src/components/place/PlaceDetails.tsx';
import { buildServices } from '../../../src/app/data/services.ts';
import { renderWithAtlas, resetAppStore } from './render-helpers.tsx';
import { withOffCampusNamed } from './synthetic-campus.ts';

describe('PlaceDetails', () => {
  beforeEach(resetAppStore);
  afterEach(cleanup);

  it('named place: category, zone, published hours, safe contact links, provenance', () => {
    // Shown as the opt-in "Nearby, outside campus" layer would show it, so the zone label is exercised.
    renderWithAtlas(<PlaceDetails placeId="osm:node/1" />, buildServices(withOffCampusNamed()));
    expect(screen.getByRole('heading', { name: 'Synthetic Food Point' })).toBeInTheDocument();
    expect(screen.getByText('Food & drink')).toBeInTheDocument();
    expect(screen.getByText('Off campus (nearby)')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getAllByText(/per published hours/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('list', { name: 'Weekly published hours' })).toHaveTextContent('Every day');
    expect(screen.getByRole('link', { name: '+91 1824 517000' })).toHaveAttribute(
      'href',
      'tel:+911824517000',
    );
    const web = screen.getByRole('link', { name: /example\.org/ });
    expect(web).toHaveAttribute('rel', 'noopener noreferrer');
    expect(web).toHaveAttribute('target', '_blank');
    expect(screen.getByText('Imported')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View this record on OpenStreetMap/ })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/node/1',
    );
    expect(screen.getByText(/Wheelchair access: Not recorded/)).toBeInTheDocument();
  });

  it('related places are labelled; nearby is explicitly not a physical connection', () => {
    renderWithAtlas(<PlaceDetails placeId="osm:node/1" />);
    const related = screen.getByRole('region', { name: 'Related places' });
    const nearby = within(related).getByText(/Nearby \(not a physical connection\) · 15 m/);
    expect(nearby).toBeInTheDocument();
    // Long relation labels wrap to a second line instead of being cut off with an ellipsis.
    expect(nearby).toHaveClass('line-clamp-2');
    expect(nearby).not.toHaveClass('truncate');
    expect(within(related).getByText(/Inside · inferred/)).toBeInTheDocument();
    expect(within(related).getByText(/come from map geometry/)).toBeInTheDocument();
  });

  it('unnamed building: honest label, explanation and estimated height', () => {
    renderWithAtlas(<PlaceDetails placeId="osm:way/2" />);
    expect(screen.getByRole('heading', { name: 'Unnamed building · 4 floors' })).toBeInTheDocument();
    expect(screen.getByText(/OpenStreetMap has no name for this building/)).toBeInTheDocument();
    expect(screen.getByText(/Estimated from 4 floors \(×3.2 m\)/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Related places' })).toHaveTextContent('Contains');
  });

  it('organization without a location: no-position note, routing disabled with a reason, no zoom', () => {
    renderWithAtlas(<PlaceDetails placeId="cur:synthetic-library" />);
    expect(screen.getByText('No verified map position.')).toBeInTheDocument();
    const to = screen.getByRole('button', { name: /Directions to here/ });
    expect(to).toBeDisabled();
    expect(to).toHaveAccessibleDescription(/No verified map position/);
    expect(screen.getByRole('button', { name: /From here/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Zoom to/ })).toBeNull();
    expect(screen.getByText('Synthetic library page')).toBeInTheDocument();
    expect(screen.getByText('Hours not published')).toBeInTheDocument();
  });

  it('stale hours are flagged as possibly outdated, not as a live state', () => {
    renderWithAtlas(<PlaceDetails placeId="osm:node/4" />);
    expect(screen.getByText('May be outdated')).toBeInTheDocument();
    expect(screen.getByText(/may be outdated \(retrieved 2019-01-01/)).toBeInTheDocument();
  });

  it('unknown-format hours show the raw value; an unsafe website is never linked', () => {
    const { container } = renderWithAtlas(<PlaceDetails placeId="osm:node/5" />);
    expect(screen.getByText('Hours unknown')).toBeInTheDocument();
    expect(screen.getByText('sunrise-sunset')).toBeInTheDocument();
    expect(screen.getByText(/not a safe web address/)).toBeInTheDocument();
    for (const a of container.querySelectorAll('a'))
      expect(a.getAttribute('href')).not.toMatch(/^javascript:/i);
  });

  it('actions: directions set the destination; report opens with the place; favourite toggles', async () => {
    renderWithAtlas(<PlaceDetails placeId="osm:node/1" />);
    await userEvent.click(screen.getByRole('button', { name: /Directions to here/ }));
    expect(useAppStore.getState().destination).toMatchObject({
      placeId: 'osm:node/1',
      label: 'Synthetic Food Point',
    });
    expect(useAppStore.getState().activePanel).toBe('directions');
    await userEvent.click(screen.getByRole('button', { name: 'Report a correction' }));
    expect(useAppStore.getState().reportTarget).toEqual({
      placeId: 'osm:node/1',
      placeName: 'Synthetic Food Point',
    });
    const save = screen.getByRole('button', { name: 'Save' });
    await userEvent.click(save);
    expect(screen.getByRole('button', { name: 'Saved' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Saved' }));
  });

  it('shows straight-line distance from a known location, labelled as such', () => {
    useAppStore.setState({
      lastSample: {
        lngLat: [75.701, 31.25],
        accuracyM: 5,
        timestamp: Date.now(),
        speedMps: null,
        headingDeg: null,
      },
    });
    renderWithAtlas(<PlaceDetails placeId="osm:node/1" />);
    expect(
      screen.getByText(/straight-line from your location \(not a walking distance\)/),
    ).toBeInTheDocument();
  });

  it('handles an id that is not in the dataset', () => {
    renderWithAtlas(<PlaceDetails placeId="osm:node/999" />);
    expect(screen.getByText('This place is not in the current dataset')).toBeInTheDocument();
  });
});
