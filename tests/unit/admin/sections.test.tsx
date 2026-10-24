/**
 * Admin screens against a mocked transport (the real-server flows are in
 * tests/e2e/admin-*.spec.ts): what is shown, what each action sends, and how
 * failures are reported.
 */
import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CampusDataState } from '../../../src/admin/data/campus-data.ts';
import type { GraphFile, Place } from '../../../src/data/schema.ts';
import { T } from '../building-studio/fixtures.ts';
import { renderAdmin } from './admin-harness.tsx';
import { json, location, OWN_ID, problem, SUG_ID, suggestion, TARGET } from './fetch-mock.ts';

// Sections load lazily; under a full parallel run the first render can take longer than 1 s.
configure({ asyncUtilTimeout: 5000 });

// MapLibre needs WebGL: the map is replaced by a labelled box (every map action also has a form control).
vi.mock('../../../src/admin/map/MapPanel.tsx', () => ({
  MapPanel: ({ label }: { label: string }) => <section aria-label={label} data-testid="map-panel" />,
}));

const GRAPH = {
  schemaVersion: 2,
  nodes: [
    [75.7032, 31.2533],
    [75.7034, 31.2533],
  ],
  edges: [
    {
      id: 0,
      from: 0,
      to: 1,
      lengthM: 19,
      highway: 'footway',
      foot: true,
      bicycle: 'no',
      steps: false,
      wheelchair: 'yes',
      onewayBicycle: false,
    },
  ],
} as unknown as GraphFile;

const BASE_PLACE = {
  id: TARGET,
  name: 'Block A',
  displayName: 'Block A',
  aliases: [],
  categoryId: 'academic',
  kind: 'building',
  location: [75.7032, 31.2533],
  campusZone: 'on-campus',
  wheelchair: 'unknown',
  provenance: { sourceId: 'osm', sourceRef: 'way/123456', verificationStatus: 'imported' },
} as unknown as Place;

const campus: CampusDataState = {
  status: 'ready',
  data: { graph: GRAPH, places: [BASE_PLACE] } as unknown as Extract<
    CampusDataState,
    { status: 'ready' }
  >['data'],
};
vi.mock('../../../src/admin/data/campus-data.ts', () => ({ useAdminCampusData: () => campus }));

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

const detail = (over: Parameters<typeof suggestion>[0] = {}) => ({
  suggestion: suggestion(over),
  possibleDuplicates: [
    {
      id: 'osm:node/1',
      kind: 'place',
      name: 'Photocopy Shop',
      distanceM: 12,
      reason: 'Similar name (90% match) 12 m away',
    },
  ],
  history: [
    {
      id: 1,
      at: T,
      actor: 'public',
      action: 'suggestion.create',
      entityType: 'suggestion',
      entityId: SUG_ID,
      before: null,
      after: { name: 'Photocopy shop' },
      outcome: 'success',
      detail: null,
    },
  ],
});

describe('moderation queue', () => {
  it('lists pending suggestions with status counts and filters through the URL', async () => {
    const user = userEvent.setup();
    const { calls } = renderAdmin('/admin/queue', (c) =>
      c.path === '/api/admin/suggestions' ? json({ items: [suggestion()], nextCursor: 'next1' }) : undefined,
    );
    const list = await screen.findByRole('list', { name: 'Suggestions' });
    expect(within(list).getByRole('link', { name: /Photocopy shop/ })).toHaveAttribute(
      'href',
      `/admin/queue/${SUG_ID}`,
    );
    expect(screen.getByText(/Showing 1 suggestion \(more available\)/)).toBeInTheDocument();
    const status = screen.getByRole('navigation', { name: 'Suggestion status' });
    expect(within(status).getByRole('link', { name: /Pending\s*2/ })).toHaveAttribute('aria-current', 'page');
    const q = calls.find((c) => c.path === '/api/admin/suggestions')!;
    expect(new URLSearchParams(q.search).get('status')).toBe('pending');

    await user.click(within(status).getByRole('link', { name: /Approved/ }));
    expect(window.location.search).toBe('?status=approved');
    await waitFor(() =>
      expect(
        calls.some((c) => c.path === '/api/admin/suggestions' && c.search.includes('status=approved')),
      ).toBe(true),
    );
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(calls.some((c) => c.search.includes('cursor=next1'))).toBe(true));
  });

  it('shows the error and a retry when the list cannot be loaded (never an empty queue)', async () => {
    renderAdmin('/admin/queue', (c) =>
      c.path === '/api/admin/suggestions' ? problem(503, 'unavailable', 'Database unavailable') : undefined,
    );
    expect(await screen.findByText('Could not load suggestions')).toBeInTheDocument();
    expect(screen.queryByText('Nothing here')).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('suggestion detail', () => {
  it('shows the submission, duplicate candidates, history and only the allowed actions', async () => {
    renderAdmin(`/admin/queue/${SUG_ID}`, (c) =>
      c.path === `/api/admin/suggestions/${SUG_ID}`
        ? json(detail({ evidenceUrl: 'https://example.org/notice' }))
        : undefined,
    );
    expect(await screen.findByRole('heading', { name: 'Photocopy shop', level: 1 })).toBeInTheDocument();
    const evidence = screen.getByRole('link', { name: 'https://example.org/notice' });
    expect(evidence).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    expect(screen.getByText(/Base place · Similar name \(90% match\) 12 m away/)).toBeInTheDocument();
    for (const name of ['Edit', 'Approve…', 'Needs information…', 'Reject…', 'Mark as duplicate…'])
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull();
    expect(
      within(screen.getByRole('list', { name: 'History events' })).getByText('Suggestion submitted'),
    ).toBeInTheDocument();
  });

  it('reject sends the loaded revision and the private reason', async () => {
    const user = userEvent.setup();
    const { writes } = renderAdmin(`/admin/queue/${SUG_ID}`, (c) => {
      if (c.method === 'POST' && c.path.endsWith('/reject'))
        return json(suggestion({ status: 'rejected', revision: 2 }));
      if (c.path === `/api/admin/suggestions/${SUG_ID}`) return json(detail());
      return undefined;
    });
    await user.click(await screen.findByRole('button', { name: 'Reject…' }));
    const dialog = screen.getByRole('dialog', { name: 'Reject this suggestion' });
    await user.type(within(dialog).getByLabelText('Reason (optional, private)'), 'Not on campus');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(writes()[0]).toMatchObject({
      method: 'POST',
      path: `/api/admin/suggestions/${SUG_ID}/reject`,
      body: { revision: 1, reason: 'Not on campus' },
      headers: expect.objectContaining({ 'x-csrf-token': 'c1' }),
    });
  });

  it('a conflict keeps the dialog open, says why, and offers the current version', async () => {
    const user = userEvent.setup();
    renderAdmin(`/admin/queue/${SUG_ID}`, (c) => {
      if (c.method === 'POST')
        return problem(409, 'conflict', 'This suggestion was changed by someone else.', {
          details: { current: suggestion({ revision: 5 }) },
        });
      if (c.path === `/api/admin/suggestions/${SUG_ID}`) return json(detail());
      return undefined;
    });
    await user.click(await screen.findByRole('button', { name: 'Needs information…' }));
    const dialog = screen.getByRole('dialog', { name: 'Mark as needing information' });
    expect(dialog).toHaveTextContent('No email or message is sent');
    await user.click(within(dialog).getByRole('button', { name: 'Mark as needing information' }));
    expect(
      await within(dialog).findByText(/changed by someone else\. \(The current version is revision 5\.\)/),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Load the current version' })).toBeInTheDocument();
  });

  it('duplicate of a listed candidate pre-fills its id', async () => {
    const user = userEvent.setup();
    const { writes } = renderAdmin(`/admin/queue/${SUG_ID}`, (c) => {
      if (c.method === 'POST')
        return json(suggestion({ status: 'duplicate', duplicateOf: 'osm:node/1', revision: 2 }));
      if (c.path === `/api/admin/suggestions/${SUG_ID}`) return json(detail());
      return undefined;
    });
    await user.click(await screen.findByRole('button', { name: 'Duplicate of this…' }));
    const dialog = screen.getByRole('dialog', { name: 'Mark as a duplicate' });
    expect(within(dialog).getByLabelText('Duplicate of (record id)')).toHaveValue('osm:node/1');
    await user.click(within(dialog).getByRole('button', { name: 'Mark as duplicate' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.body).toEqual({ revision: 1, duplicateOf: 'osm:node/1' });
  });

  it('approval needs an explicit access-point choice from the validated nodes and sends only corrections', async () => {
    const user = userEvent.setup();
    const { writes } = renderAdmin(`/admin/queue/${SUG_ID}`, (c) => {
      if (c.method === 'POST' && c.path.endsWith('/approve'))
        return json({
          suggestion: suggestion({ status: 'approved', publishedLocationId: 'com:new1', revision: 2 }),
          location: location({ id: 'com:new1', origin: 'community' }),
        });
      if (c.path === `/api/admin/suggestions/${SUG_ID}`) return json(detail());
      return undefined;
    });
    await user.click(await screen.findByRole('button', { name: 'Approve…' }));
    const nodes = screen.getAllByRole('radio');
    expect(nodes.map((n) => (n as HTMLInputElement).checked)).toEqual(nodes.map(() => false));
    expect(screen.getByRole('radio', { name: /Path node 0 \(nearest\)/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve and publish' }));
    expect(screen.getByText('Choose an access point, or “No access point”.')).toBeInTheDocument();
    expect(writes()).toHaveLength(0);

    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Photocopy centre');
    await user.click(screen.getByRole('radio', { name: /Path node 0 \(nearest\)/ }));
    await user.type(screen.getByLabelText(/Access note/), 'Side door');
    await user.click(screen.getByRole('button', { name: 'Approve and publish' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      path: `/api/admin/suggestions/${SUG_ID}/approve`,
      body: {
        revision: 1,
        fields: { name: 'Photocopy centre' },
        accessPoint: { nodeId: 0, note: 'Side door' },
      },
    });
  });
});

describe('locations', () => {
  it('creates an owner location from typed coordinates with an explicit access choice', async () => {
    const user = userEvent.setup();
    const { writes } = renderAdmin('/admin/locations/new', (c) =>
      c.method === 'POST' && c.path === '/api/admin/locations'
        ? json(location({ name: 'Water point', categoryId: 'water' }), 201)
        : undefined,
    );
    expect(await screen.findByRole('heading', { name: 'New location', level: 1 })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Latitude'), '31.2533');
    await user.type(screen.getByLabelText('Longitude'), '75.7032{Enter}');
    await user.type(screen.getByLabelText('Name'), 'Water point');
    await user.selectOptions(screen.getByLabelText('Category'), 'water');
    await user.click(screen.getByRole('button', { name: 'Create and publish' }));
    expect(screen.getByText('Choose an access point, or “No access point”.')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /No access point/ }));
    await user.click(screen.getByRole('button', { name: 'Create and publish' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.body).toEqual({
      fields: {
        name: 'Water point',
        categoryId: 'water',
        location: [75.7032, 31.2533],
        wheelchair: 'unknown',
        verificationStatus: 'unverified',
      },
    });
    await waitFor(() =>
      expect(window.location.pathname).toBe(`/admin/locations/${encodeURIComponent(OWN_ID)}`),
    );
  });

  it('edits send only changes; delete of a hidden location needs the exact name', async () => {
    const user = userEvent.setup();
    const hidden = location({ status: 'hidden', revision: 3, accessNodeId: 0 });
    const { writes } = renderAdmin(`/admin/locations/${encodeURIComponent(OWN_ID)}`, (c) => {
      if (c.method === 'GET' && c.path === '/api/admin/locations') return json({ items: [hidden] });
      if (c.method === 'PATCH') return json({ ...hidden, name: 'Copy shop', revision: 4 });
      if (c.method === 'DELETE') return json({ deleted: OWN_ID });
      return undefined;
    });
    expect(await screen.findByRole('heading', { name: 'Photocopy shop', level: 1 })).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: /Keep the current access point \(path node 0\)/ }),
    ).toBeChecked();
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Copy shop');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: 'PATCH',
      body: { revision: 3, fields: { name: 'Copy shop' } },
    });

    await user.click(await screen.findByRole('button', { name: 'Delete permanently…' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete this location permanently?' });
    const confirm = within(dialog).getByRole('button', { name: 'Delete permanently' });
    await user.type(within(dialog).getByRole('textbox'), 'copy shop');
    expect(confirm).toBeDisabled();
    await user.clear(within(dialog).getByRole('textbox'));
    await user.type(within(dialog).getByRole('textbox'), 'Copy shop');
    await user.click(confirm);
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]).toMatchObject({ method: 'DELETE', body: { revision: 4, confirmName: 'Copy shop' } });
  });
});

describe('overrides', () => {
  const ov = (over = {}) => ({
    targetId: TARGET,
    fields: { name: 'Old name', openingHours: '24/7' },
    hidden: false,
    accessNodeId: null,
    accessNote: null,
    note: null,
    baseDatasetVersion: 'abc123',
    updatedBy: 'owner',
    updatedAt: T,
    revision: 2,
    orphan: false,
    orphanReason: null,
    baseName: 'Block A',
    ...over,
  });

  it('an orphan shows its reason and the rollback advice; nothing is editable but deletion', async () => {
    renderAdmin(`/admin/overrides/${encodeURIComponent('osm:way/9')}`, (c) =>
      c.path === `/api/admin/overrides/${encodeURIComponent('osm:way/9')}`
        ? json({
            targetId: 'osm:way/9',
            place: null,
            override: ov({ targetId: 'osm:way/9', orphan: true, orphanReason: 'boundary-review' }),
            orphan: true,
          })
        : undefined,
    );
    expect(await screen.findByText('Orphaned override: not applied')).toBeInTheDocument();
    const why = screen.getByRole('region', { name: 'Why it is not applied' });
    expect(within(why).getByText('Held for boundary review')).toBeInTheDocument();
    expect(screen.getByText(/applies again automatically once the owner confirms/)).toBeInTheDocument();
    expect(screen.getByText(/docs\/DATA_ROLLBACK\.md/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete this orphaned override…' })).toBeInTheDocument();
  });

  it('saving keeps fields this screen does not edit', async () => {
    const user = userEvent.setup();
    const { writes } = renderAdmin(`/admin/overrides/${encodeURIComponent(TARGET)}`, (c) => {
      if (c.method === 'PUT')
        return json({
          override: { ...ov(), fields: { name: 'New Block', openingHours: '24/7' }, revision: 3 },
        });
      if (c.path === `/api/admin/overrides/${encodeURIComponent(TARGET)}`)
        return json({ targetId: TARGET, place: BASE_PLACE, override: ov(), orphan: false });
      return undefined;
    });
    const name = await screen.findByLabelText('Name');
    expect(name).toHaveValue('Old name');
    await user.clear(name);
    await user.type(name, 'New Block');
    await user.click(screen.getByLabelText('Hidden from the public map'));
    await user.click(screen.getByRole('button', { name: 'Save override' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.body).toEqual({
      revision: 2,
      fields: { openingHours: '24/7', name: 'New Block' },
      hidden: true,
    });
  });
});

describe('history and quality', () => {
  const events = [
    {
      id: 9,
      at: T,
      actor: 'owner',
      action: 'location.update',
      entityType: 'location',
      entityId: OWN_ID,
      before: { name: 'A', revision: 1 },
      after: { name: 'B', revision: 2 },
      outcome: 'success',
      detail: null,
    },
    {
      id: 8,
      at: T,
      actor: 'owner',
      action: 'suggestion.approve',
      entityType: 'suggestion',
      entityId: SUG_ID,
      before: null,
      after: null,
      outcome: 'success',
      detail: 'Published as com:x',
    },
  ];

  it('offers revert only where the server supports it and reports the result', async () => {
    const user = userEvent.setup();
    const { writes } = renderAdmin('/admin/audit', (c) => {
      if (c.path === '/api/admin/audit') return json({ items: events, nextCursor: 8 });
      if (c.path === '/api/admin/revert')
        return json({ revertedEventId: 9, entityType: 'location', entityId: OWN_ID, record: null });
      return undefined;
    });
    const list = await screen.findByRole('list', { name: 'History events' });
    const items = within(list).getAllByRole('listitem');
    expect(within(items[0]!).getByRole('button', { name: 'Revert…' })).toBeInTheDocument();
    expect(within(items[1]!).queryByRole('button', { name: 'Revert…' })).toBeNull();
    expect(within(items[0]!).getByRole('link', { name: OWN_ID })).toHaveAttribute(
      'href',
      `/admin/locations/${encodeURIComponent(OWN_ID)}`,
    );
    await user.click(within(items[0]!).getByText('1 field'));
    expect(within(items[0]!).getByRole('row', { name: /name A B/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load older events' })).toBeInTheDocument();

    await user.click(within(items[0]!).getByRole('button', { name: 'Revert…' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Revert this change?' })).getByRole('button', {
        name: 'Revert',
      }),
    );
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ path: '/api/admin/revert', body: { auditEventId: 9 } });
  });

  it('filters the history through the URL', async () => {
    const user = userEvent.setup();
    const { calls } = renderAdmin('/admin/audit?entity=override');
    await screen.findByText('No matching events');
    expect(calls.find((c) => c.path === '/api/admin/audit')!.search).toContain('entity=override');
    await user.selectOptions(screen.getByLabelText('Action'), 'override.hide');
    await waitFor(() => expect(window.location.search).toBe('?entity=override&action=override.hide'));
  });

  it('quality groups warnings with links and orphan reasons', async () => {
    renderAdmin('/admin/quality', (c) =>
      c.path === '/api/admin/quality'
        ? json({
            warnings: [
              {
                kind: 'orphan-override',
                entityType: 'override',
                id: 'osm:way/9',
                message: 'Override target is not a campus place.',
                orphanReason: 'context-layer',
              },
              {
                kind: 'location-not-routable',
                entityType: 'location',
                id: OWN_ID,
                message: 'No access point.',
              },
            ],
            counts: {
              'orphan-override': 1,
              'override-access-invalid': 0,
              'location-outside-boundary': 0,
              'location-not-routable': 1,
              'possible-duplicate': 0,
              'stale-pending': 0,
            },
          })
        : undefined,
    );
    expect(await screen.findByRole('region', { name: 'Orphaned overrides (1)' })).toBeInTheDocument();
    expect(screen.getByText('Now an off-campus place')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: `Open ${OWN_ID}` })).toHaveAttribute(
      'href',
      `/admin/locations/${encodeURIComponent(OWN_ID)}`,
    );
    expect(screen.getByRole('region', { name: 'Overview' })).toHaveTextContent('Pending 2');
  });
});
