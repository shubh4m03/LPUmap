/**
 * The owner is told BEFORE publishing that a point outside the campus
 * boundary goes only to the opt-in "Nearby, outside campus" layer and is not
 * routable (approve dialog and location editor). The verdict is the merge
 * service's own (boundary polygons, point in polygon).
 */
import { cleanup, configure, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CampusDataState } from '../../../src/admin/data/campus-data.ts';
import { campusZoneOf } from '../../../src/admin/map/campus-zone.ts';
import { campusZoneFor, boundaryPolygons } from '../../../src/community/geo.ts';
import type { BoundaryFile, GraphFile, LngLat } from '../../../src/data/schema.ts';
import { renderAdmin } from './admin-harness.tsx';
import { json, SUG_ID, suggestion } from './fetch-mock.ts';

configure({ asyncUtilTimeout: 5000 });

vi.mock('../../../src/admin/map/MapPanel.tsx', () => ({
  MapPanel: ({ label }: { label: string }) => <section aria-label={label} data-testid="map-panel" />,
}));

/** A square campus around [75.703, 31.253] (about 200 m a side). */
const BOUNDARY = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [75.702, 31.252],
            [75.704, 31.252],
            [75.704, 31.254],
            [75.702, 31.254],
            [75.702, 31.252],
          ],
        ],
      },
    },
  ],
} as unknown as BoundaryFile;

const INSIDE: LngLat = [75.7032, 31.2533];
const OUTSIDE: LngLat = [75.7062, 31.2533];

const GRAPH = { schemaVersion: 2, nodes: [], edges: [] } as unknown as GraphFile;
const campus: CampusDataState = {
  status: 'ready',
  data: { graph: GRAPH, places: [], boundary: BOUNDARY } as unknown as Extract<
    CampusDataState,
    { status: 'ready' }
  >['data'],
};
vi.mock('../../../src/admin/data/campus-data.ts', () => ({ useAdminCampusData: () => campus }));

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('campusZoneOf', () => {
  it('agrees with the merge service and is unknown without a boundary or a point', () => {
    const polygons = boundaryPolygons(BOUNDARY);
    for (const p of [INSIDE, OUTSIDE]) {
      expect(campusZoneOf(BOUNDARY, p)).toBe(
        campusZoneFor(p, polygons) === 'on-campus' ? 'on-campus' : 'outside',
      );
    }
    expect(campusZoneOf(BOUNDARY, INSIDE)).toBe('on-campus');
    expect(campusZoneOf(BOUNDARY, OUTSIDE)).toBe('outside');
    expect(campusZoneOf(null, OUTSIDE)).toBe('unknown');
    expect(campusZoneOf(BOUNDARY, null)).toBe('unknown');
    expect(
      campusZoneOf({ type: 'FeatureCollection', features: [] } as unknown as BoundaryFile, OUTSIDE),
    ).toBe('unknown');
  });
});

async function openApprove(location: LngLat) {
  const user = userEvent.setup();
  const view = renderAdmin(`/admin/queue/${SUG_ID}`, (c) =>
    c.path === `/api/admin/suggestions/${SUG_ID}`
      ? json({ suggestion: suggestion({ location }), possibleDuplicates: [], history: [] })
      : undefined,
  );
  await user.click(await screen.findByRole('button', { name: 'Approve…' }));
  await screen.findByRole('button', { name: 'Approve and publish' });
  return { ...view, user };
}

describe('approve dialog', () => {
  it('warns before publishing a suggestion outside the campus boundary', async () => {
    await openApprove(OUTSIDE);
    const notice = screen.getByTestId('outside-campus-notice');
    expect(notice).toHaveTextContent('Outside the campus boundary');
    expect(notice).toHaveTextContent('only in the opt-in “Nearby, outside campus” map layer');
    expect(notice).toHaveTextContent('not routable');
    // It is part of the form, before the publish button.
    const button = screen.getByRole('button', { name: 'Approve and publish' });
    expect(notice.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('offers no access point for an off-campus suggestion and approves without one', async () => {
    const user = userEvent.setup();
    const { writes } = renderAdmin(`/admin/queue/${SUG_ID}`, (c) => {
      if (c.method === 'POST' && c.path.endsWith('/approve'))
        return json({ suggestion: suggestion({ location: OUTSIDE, status: 'approved', revision: 2 }) });
      return c.path === `/api/admin/suggestions/${SUG_ID}`
        ? json({ suggestion: suggestion({ location: OUTSIDE }), possibleDuplicates: [], history: [] })
        : undefined;
    });
    await user.click(await screen.findByRole('button', { name: 'Approve…' }));
    expect(await screen.findByTestId('access-point-off-campus')).toHaveTextContent('not routable');
    expect(screen.queryByRole('radio')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Approve and publish' }));
    expect(screen.queryByText('Choose an access point, or “No access point”.')).toBeNull();
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.body).not.toHaveProperty('accessPoint');
  });

  it('says nothing for a suggestion on campus, and updates when the point moves outside', async () => {
    const { user } = await openApprove(INSIDE);
    expect(screen.queryByTestId('outside-campus-notice')).toBeNull();
    const lon = screen.getByLabelText('Longitude');
    await user.clear(lon);
    await user.type(lon, `${OUTSIDE[0]}{Enter}`);
    await waitFor(() => expect(screen.getByTestId('outside-campus-notice')).toBeInTheDocument());
  });
});

describe('location editor', () => {
  it('warns when a new location is placed outside the campus boundary', async () => {
    const user = userEvent.setup();
    renderAdmin('/admin/locations/new');
    await screen.findByRole('heading', { name: 'New location', level: 1 });
    await user.type(screen.getByLabelText('Latitude'), String(OUTSIDE[1]));
    await user.type(screen.getByLabelText('Longitude'), `${OUTSIDE[0]}{Enter}`);
    expect(await screen.findByTestId('outside-campus-notice')).toHaveTextContent('not routable');
  });
});
