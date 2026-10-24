/**
 * Choosing an access point on the map (approve dialog, location editor): a
 * click lists the VALIDATED candidates near it, the owner picks one; nothing
 * is chosen automatically, the point does not move, and nodes that are not
 * candidates are never offered.
 */
import { act, cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CampusDataState } from '../../../src/admin/data/campus-data.ts';
import { ACCESS_PICK_RADIUS_M, candidatesNearClick } from '../../../src/admin/map/access-pick.ts';
import type { GraphFile, LngLat } from '../../../src/data/schema.ts';
import type { MapEditingProps } from '../../../src/map/editing/types.ts';
import { renderAdmin } from './admin-harness.tsx';
import { json, location, SUG_ID, suggestion } from './fetch-mock.ts';

configure({ asyncUtilTimeout: 5000 });

const mapEditing: { current: MapEditingProps | null } = { current: null };
vi.mock('../../../src/admin/map/MapPanel.tsx', () => ({
  MapPanel: ({ label, editing }: { label: string; editing: MapEditingProps }) => {
    mapEditing.current = editing;
    return <section aria-label={label} data-testid="map-panel" />;
  },
}));

const PLACE: LngLat = [75.7032, 31.2533];
const N1: LngLat = [75.7034, 31.2533]; // about 19 m east, walkable
const N2: LngLat = [75.70325, 31.25335]; // about 7 m away, NOT walkable (no foot edge)
const edge = (id: number, from: number, to: number, foot: boolean) => ({
  id,
  from,
  to,
  lengthM: 19,
  highway: foot ? 'footway' : 'service',
  foot,
  bicycle: 'no',
  steps: false,
  wheelchair: 'yes',
  onewayBicycle: false,
});
const GRAPH = {
  schemaVersion: 2,
  nodes: [PLACE, N1, N2],
  edges: [edge(0, 0, 1, true), edge(1, 2, 2, false)],
} as unknown as GraphFile;
const campus: CampusDataState = {
  status: 'ready',
  data: { graph: GRAPH, places: [] } as unknown as Extract<CampusDataState, { status: 'ready' }>['data'],
};
vi.mock('../../../src/admin/data/campus-data.ts', () => ({ useAdminCampusData: () => campus }));

afterEach(() => {
  cleanup();
  mapEditing.current = null;
  window.history.replaceState(null, '', '/');
});

const editing = () => {
  if (!mapEditing.current) throw new Error('no map editing props');
  return mapEditing.current;
};
const click = (p: LngLat) => act(() => editing().onPointer?.({ type: 'click', lngLat: p, placeId: null }));

describe('candidatesNearClick', () => {
  const cands = [
    { nodeId: 4, position: [75.7034, 31.2533] as LngLat },
    { nodeId: 2, position: [75.7032, 31.2533] as LngLat },
    { nodeId: 9, position: [75.71, 31.26] as LngLat },
  ];
  it('lists only candidates within the radius, nearest to the click first', () => {
    const near = candidatesNearClick(cands, [75.70322, 31.2533]);
    expect(near.map((c) => c.nodeId)).toEqual([2, 4]);
    expect(near[0]!.fromClickM).toBeLessThan(3);
    expect(near.every((c) => c.fromClickM <= ACCESS_PICK_RADIUS_M)).toBe(true);
    expect(candidatesNearClick(cands, [75.72, 31.27])).toEqual([]);
    expect(candidatesNearClick(cands, [75.70322, 31.2533], 25, 1).map((c) => c.nodeId)).toEqual([2]);
  });
});

async function openApprove() {
  const user = userEvent.setup();
  const view = renderAdmin(`/admin/queue/${SUG_ID}`, (c) => {
    if (c.method === 'POST' && c.path.endsWith('/approve'))
      return json({
        suggestion: suggestion({ status: 'approved', publishedLocationId: 'com:new1', revision: 2 }),
        location: location({ id: 'com:new1', origin: 'community' }),
      });
    if (c.path === `/api/admin/suggestions/${SUG_ID}`)
      return json({ suggestion: suggestion({ location: PLACE }), possibleDuplicates: [], history: [] });
    return undefined;
  });
  await user.click(await screen.findByRole('button', { name: 'Approve…' }));
  await screen.findByRole('button', { name: 'Approve and publish' });
  return { ...view, user };
}

describe('approve dialog: choose the access point on the map', () => {
  it('a click lists the valid nodes near it; the owner picks one; the point never moves', async () => {
    const { user, writes } = await openApprove();
    // Before picking, a click moves the point (desktop editing).
    expect(editing().handles).toHaveLength(1);
    await user.click(screen.getByTestId('access-pick-start'));
    const box = screen.getByTestId('access-pick');
    expect(box).toHaveTextContent('nothing is chosen until you pick one');
    // While picking: no drag handle, clicks go to the picker.
    expect(editing().handles).toEqual([]);
    expect(editing().input).toBe('pointer');

    // Near the non-walkable node N2 and the place: only VALID candidates are listed (node 0, node 1).
    click(N2);
    const list = within(box).getByRole('list', { name: 'Path nodes near the click' });
    expect(
      within(list)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Use path node 0', 'Use path node 1']);
    expect(within(box).queryByRole('button', { name: 'Use path node 2' })).toBeNull();
    // The click is drawn as a guide; the edited point stays where it was.
    const ids = editing().preview!.features.map((f) => f.properties.id);
    expect(ids).toContain('pick-click');
    expect(screen.getByLabelText('Longitude')).toHaveValue(String(PLACE[0]));
    // Nothing chosen yet.
    expect(screen.getAllByRole('radio').every((r) => !(r as HTMLInputElement).checked)).toBe(true);

    // A click far from every candidate explains itself and offers nothing.
    click([75.7062, 31.2533]);
    expect(within(box).getByRole('status')).toHaveTextContent('No valid path node within 25 m');
    expect(within(box).queryByRole('list')).toBeNull();

    click(N1);
    await user.click(within(box).getByRole('button', { name: 'Use path node 1' }));
    expect(screen.queryByTestId('access-pick')).toBeNull();
    expect(screen.getByRole('radio', { name: /Path node 1/ })).toBeChecked();
    // Back to normal editing.
    expect(editing().handles).toHaveLength(1);
    expect(screen.getByLabelText('Longitude')).toHaveValue(String(PLACE[0]));

    await user.click(screen.getByRole('button', { name: 'Approve and publish' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.body).toMatchObject({ accessPoint: { nodeId: 1 } });
  });

  it('Stop choosing on the map leaves the choice unset', async () => {
    const { user } = await openApprove();
    await user.click(screen.getByTestId('access-pick-start'));
    click(PLACE);
    await user.click(screen.getByTestId('access-pick-cancel'));
    expect(screen.queryByTestId('access-pick')).toBeNull();
    expect(screen.getAllByRole('radio').every((r) => !(r as HTMLInputElement).checked)).toBe(true);
    expect(editing().preview!.features.map((f) => f.properties.id)).not.toContain('pick-click');
  });
});

describe('location editor: choose the access point on the map', () => {
  it('picks a listed node for a new location', async () => {
    const user = userEvent.setup();
    renderAdmin('/admin/locations/new');
    await screen.findByRole('heading', { name: 'New location', level: 1 });
    await user.type(screen.getByLabelText('Latitude'), String(PLACE[1]));
    await user.type(screen.getByLabelText('Longitude'), `${PLACE[0]}{Enter}`);
    await user.click(await screen.findByTestId('access-pick-start'));
    click(N1);
    await user.click(screen.getByRole('button', { name: 'Use path node 1' }));
    expect(screen.getByRole('radio', { name: /Path node 1/ })).toBeChecked();
  });
});
