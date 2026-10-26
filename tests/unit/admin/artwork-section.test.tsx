/**
 * The admin Artwork section against a mocked transport (the real-server flow
 * is tests/e2e/admin-artwork.spec.ts): exact labels, the original artwork with
 * outlines in ONE transform, candidate footprints, the decision form (what
 * each action sends, what is refused before sending), 409/422 reporting,
 * reset, and the nav entry.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CampusDataState } from '../../../src/admin/data/campus-data.ts';
import { buildingsFileSchema } from '../../../src/data/schema.ts';
import { isometricArtManifestSchema } from '../../../src/isometric-art/schema.ts';
import { renderAdmin } from './admin-harness.tsx';
import { json, problem } from './fetch-mock.ts';

configure({ asyncUtilTimeout: 8000 });

const root = process.cwd();
const manifest = isometricArtManifestSchema.parse(
  JSON.parse(readFileSync(join(root, 'public/isometric-art/manifest.json'), 'utf8')),
);
const buildings = buildingsFileSchema.parse(
  JSON.parse(readFileSync(join(root, 'public/data/buildings.geojson'), 'utf8')),
);

vi.mock('../../../src/admin/map/MapPanel.tsx', () => ({
  MapPanel: ({ label }: { label: string }) => <section aria-label={label} data-testid="map-panel" />,
}));
const campus: CampusDataState = {
  status: 'ready',
  data: { buildings, places: [], graph: { nodes: [], edges: [] } } as unknown as Extract<
    CampusDataState,
    { status: 'ready' }
  >['data'],
};
vi.mock('../../../src/admin/data/campus-data.ts', () => ({ useAdminCampusData: () => campus }));
vi.mock('../../../src/admin/sections/artwork/useArtworkManifest.ts', () => ({
  useArtworkManifest: () => ({ status: 'ready', manifest }),
}));

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

const BUILDING = 'osm:way/422437890';
const baseline = (id: string) => manifest.associations.find((a) => a.subjectId === id)!;

function effectiveOf(id: string, decision: ReturnType<typeof decisionRow> | null = null) {
  const b = baseline(id);
  const st = decision ? decision.status : b.status;
  const building = decision ? decision.buildingId : b.buildingId;
  return {
    subjectId: id,
    status: st,
    buildingId: st === 'verified' ? building : null,
    unconfirmedMatchId: st === 'approximate' ? building : null,
    evidence: decision ? decision.evidence : b.evidence,
    candidateFootprints: b.candidateFootprints,
    reason: decision ? null : b.reason,
    source: decision ? 'owner' : 'curated',
    revision: decision ? decision.revision : b.revision,
    updatedAt: decision ? decision.updatedAt : null,
  };
}

function decisionRow(id: string, over: Record<string, unknown> = {}) {
  return {
    subjectId: id,
    status: 'verified' as const,
    buildingId: BUILDING as string | null,
    evidence: [{ kind: 'site-sign' as const, description: 'Sign reads Block 34', date: '2026-10-20' }],
    note: 'PRIVATE note',
    createdBy: 'owner',
    createdAt: '2026-10-24T09:00:00.000Z',
    updatedBy: 'owner',
    updatedAt: '2026-10-24T09:00:00.000Z',
    revision: 2,
    ...over,
  };
}

const viewOf = (id: string, decision: ReturnType<typeof decisionRow> | null = null) => ({
  subjectId: id,
  baseline: baseline(id),
  decision,
  effective: effectiveOf(id, decision),
});
const detailOf = (id: string, decision: ReturnType<typeof decisionRow> | null = null) => ({
  ...viewOf(id, decision),
  history: decision
    ? [
        {
          id: 7,
          at: '2026-10-24T09:00:00.000Z',
          actor: 'owner',
          action: 'artwork.put',
          entityType: 'artwork',
          entityId: id,
          before: null,
          after: decision,
          outcome: 'success',
          detail: null,
        },
      ]
    : [],
});
const listOf = () => ({ items: manifest.subjects.map((s) => viewOf(s.subjectId)), issues: [] });

describe('Artwork list', () => {
  it('is in the admin nav and lists every illustrated item with its exact label and status', async () => {
    renderAdmin('/admin/artwork', (c) =>
      c.method === 'GET' && c.path === '/api/admin/artwork/associations' ? json(listOf()) : undefined,
    );
    const nav = await screen.findByRole('navigation', { name: 'Admin sections' });
    expect(within(nav).getByRole('link', { name: 'Artwork' })).toHaveAttribute('aria-current', 'page');
    const list = await screen.findByRole('list', { name: 'Illustrated items' });
    const links = within(list).getAllByRole('link');
    expect(links).toHaveLength(manifest.subjects.length);
    // Exact text in the DOM, the double space included.
    const cafe = within(list).getByRole('link', { name: /BALDEV RAJ AUDITORIUM/ });
    expect(cafe.querySelector('[data-exact-label]')!.textContent).toBe(
      'CAMPUS CAFE  & BALDEV RAJ AUDITORIUM',
    );
    expect(cafe).toHaveAttribute('href', '/admin/artwork/art%3Anum-2');
    // The held caption is not shown in the list.
    expect(list.textContent).not.toContain('DILDO');
    expect(screen.getByRole('radio', { name: /^Verified \(0\)/ })).toBeInTheDocument();
  });

  it('shows every artwork file unchanged in the files view', async () => {
    renderAdmin('/admin/artwork?view=files', (c) =>
      c.path === '/api/admin/artwork/associations' ? json(listOf()) : undefined,
    );
    const files = await screen.findByRole('list', { name: 'Artwork files' });
    const imgs = within(files).getAllByTestId('artwork-original-image');
    expect(imgs).toHaveLength(manifest.assets.length);
    for (const img of imgs) {
      const a = manifest.assets.find((x) => x.assetId === img.getAttribute('data-asset-id'))!;
      expect(img.getAttribute('src')).toBe(`/isometric-art/${a.original!.url}`);
      expect(img.getAttribute('width')).toBe(String(a.source.width));
      expect(img.getAttribute('height')).toBe(String(a.source.height));
      expect(img.getAttribute('style')).toBeNull(); // no filter, no forced size
    }
  });
});

describe('Artwork item page', () => {
  const SUBJECT = 'art:num-25';

  it('shows exact labels with sources, the number note, the master with outlines in one transform, and vignettes', async () => {
    renderAdmin(`/admin/artwork/${encodeURIComponent(SUBJECT)}`, (c) =>
      c.path === `/api/admin/artwork/associations/${encodeURIComponent(SUBJECT)}`
        ? json(detailOf(SUBJECT))
        : undefined,
    );
    const labels = await screen.findByRole('region', { name: 'Printed labels (exact)' });
    expect(within(labels).getByText('BLOCK-25,26:')).toBeInTheDocument();
    expect(within(labels).getByText(/not an official LPU block number/)).toBeInTheDocument();

    const overview = screen.getByTestId('artwork-hotspot-overview');
    expect(overview.getAttribute('viewBox')).toBe('0 0 3371 2384');
    const img = within(overview).getByTestId('artwork-master-image');
    expect([
      img.getAttribute('x'),
      img.getAttribute('y'),
      img.getAttribute('width'),
      img.getAttribute('height'),
    ]).toEqual(['0', '0', '3371', '2384']);
    expect(img.getAttribute('href')).toBe('/isometric-art/original/1-lpu-isometric-map-design-3371.jpg');
    const poly = overview.querySelector('polygon[data-hotspot-id="hs-pin-25"]')!;
    const h = manifest.hotspots.find((x) => x.hotspotId === 'hs-pin-25')!;
    const pts = poly
      .getAttribute('points')!
      .split(' ')
      .map((p) => p.split(',').map(Number));
    expect(pts).toHaveLength(h.polygon.length);
    pts.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(h.polygon[i]![0] * 3371, 2);
      expect(y).toBeCloseTo(h.polygon[i]![1] * 2384, 2);
    });
    // Needs-review outlines are drawn dashed, never as certain.
    expect(poly.getAttribute('data-review-status')).toBe(h.reviewStatus);
    if (h.reviewStatus === 'needs-manual-verification')
      expect(poly.getAttribute('stroke-dasharray')).toBeTruthy();

    const zoom = screen.getByTestId('artwork-hotspot-zoom');
    const [zx, zy, zw, zh] = zoom.getAttribute('viewBox')!.split(' ').map(Number);
    expect(zx).toBeGreaterThanOrEqual(0);
    expect(zy).toBeGreaterThanOrEqual(0);
    expect(zx! + zw!).toBeLessThanOrEqual(3371);
    expect(zy! + zh!).toBeLessThanOrEqual(2384);
    for (const [x, y] of pts) {
      expect(x! >= zx! && x! <= zx! + zw!).toBe(true);
      expect(y! >= zy! && y! <= zy! + zh!).toBe(true);
    }
    // The zoom uses the very same image placement.
    expect(within(zoom).getByTestId('artwork-master-image').getAttribute('width')).toBe('3371');

    const vignettes = screen.getByRole('region', { name: 'Vignettes' });
    expect(within(vignettes).getByTestId('artwork-original-image')).toHaveAttribute(
      'src',
      '/isometric-art/original/87-lpu-isometric-map-design-963.png',
    );
    // Candidate footprints (research leads), with the map.
    const cands = screen.getByRole('list', { name: /Candidate footprints/ });
    expect(within(cands).getAllByRole('listitem')).toHaveLength(baseline(SUBJECT).candidateFootprints.length);
    expect(screen.getByTestId('map-panel')).toBeInTheDocument();
  });

  it('refuses verified without evidence before sending; with evidence it PUTs the exact body and reloads', async () => {
    const user = userEvent.setup();
    let saved = false;
    const { writes } = renderAdmin(`/admin/artwork/${encodeURIComponent('art:num-34')}`, (c) => {
      const p = `/api/admin/artwork/associations/${encodeURIComponent('art:num-34')}`;
      if (c.path !== p) return undefined;
      if (c.method === 'PUT') {
        saved = true;
        return json(viewOf('art:num-34', decisionRow('art:num-34', { revision: 1, note: null })));
      }
      return json(
        saved ? detailOf('art:num-34', decisionRow('art:num-34', { revision: 1 })) : detailOf('art:num-34'),
      );
    });
    const form = await screen.findByRole('form', { name: 'Artwork link decision' });
    await user.click(within(form).getByRole('radio', { name: /^Verified/ }));
    const building = within(form).getByRole('textbox', { name: 'Campus building id' });
    await user.clear(building);
    await user.type(building, BUILDING);
    await user.click(within(form).getByRole('button', { name: 'Save as verified' }));
    expect(await within(form).findByText(/Verification needs evidence/)).toBeInTheDocument();
    expect(writes()).toHaveLength(0);

    await user.click(within(form).getByRole('button', { name: 'Add evidence' }));
    const ev = within(form).getByRole('group', { name: 'Evidence 1' });
    await user.type(
      within(ev).getByRole('textbox', { name: 'What the sign photo shows' }),
      'Sign reads Block 34',
    );
    const date = within(ev).getByLabelText('Date');
    await user.clear(date);
    await user.type(date, '2026-10-20');
    await user.click(within(form).getByRole('button', { name: 'Save as verified' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    const w = writes()[0]!;
    expect(w.method).toBe('PUT');
    expect(w.headers['x-csrf-token']).toBe('c1');
    expect(w.body).toEqual({
      expectedRevision: null,
      status: 'verified',
      buildingId: BUILDING,
      evidence: [{ kind: 'site-sign', description: 'Sign reads Block 34', date: '2026-10-20' }],
      note: null,
    });
    expect(await screen.findByText(/Saved and published/)).toBeInTheDocument();
  });

  it('approximate without a note and an official document without a URL are refused before sending', async () => {
    const user = userEvent.setup();
    const { writes } = renderAdmin(`/admin/artwork/${encodeURIComponent('art:num-25')}`, (c) =>
      c.path.startsWith('/api/admin/artwork/associations/') ? json(detailOf('art:num-25')) : undefined,
    );
    const form = await screen.findByRole('form', { name: 'Artwork link decision' });
    // The curated baseline (approximate) is preselected; saving it needs the private note.
    expect(within(form).getByRole('radio', { name: /^Unconfirmed match/ })).toBeChecked();
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await within(form).findByText(/Say why this is only approximate/)).toBeInTheDocument();

    await user.click(within(form).getByRole('radio', { name: /^Verified/ }));
    await user.click(within(form).getByRole('button', { name: 'Add evidence' }));
    const ev = within(form).getByRole('group', { name: 'Evidence 1' });
    await user.selectOptions(within(ev).getByRole('combobox', { name: 'Kind' }), 'official-document');
    await user.type(
      within(ev).getByRole('textbox', { name: 'Document and where it says so' }),
      'Campus directory p.4',
    );
    await user.click(within(form).getByRole('button', { name: 'Save as verified' }));
    expect(
      await within(form).findByText('Official-document evidence needs the document URL.'),
    ).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it('reports a 409 with a way to load the current version, and maps 422 issues onto fields', async () => {
    const user = userEvent.setup();
    let attempt = 0;
    renderAdmin(`/admin/artwork/${encodeURIComponent('art:num-34')}`, (c) => {
      if (!c.path.startsWith('/api/admin/artwork/associations/')) return undefined;
      if (c.method !== 'PUT') return json(detailOf('art:num-34'));
      attempt++;
      return attempt === 1
        ? problem(409, 'conflict', 'This artwork association was changed by someone else.', {
            details: { current: decisionRow('art:num-34', { revision: 5 }) },
          })
        : problem(422, 'invalid', 'Artwork association is invalid', {
            issues: [{ path: 'buildingId', message: 'osm:way/9 is not a current campus building.' }],
          });
    });
    const form = await screen.findByRole('form', { name: 'Artwork link decision' });
    await user.click(within(form).getByRole('radio', { name: /^Unresolved/ }));
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('button', { name: 'Load the current version' })).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('The server refused these values')).toBeInTheDocument();
  });

  it('resets an owner decision to the curated baseline after confirmation (DELETE with the revision)', async () => {
    const user = userEvent.setup();
    const { writes } = renderAdmin(`/admin/artwork/${encodeURIComponent('art:num-34')}`, (c) => {
      if (!c.path.startsWith('/api/admin/artwork/associations/')) return undefined;
      if (c.method === 'DELETE') return json(viewOf('art:num-34'));
      return json(detailOf('art:num-34', decisionRow('art:num-34', { revision: 3 })));
    });
    const current = await screen.findByRole('region', { name: 'Current link' });
    expect(within(current).getByText('PRIVATE note')).toBeInTheDocument();
    await user.click(within(current).getByRole('button', { name: /Reset to the curated baseline/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'DELETE', body: { expectedRevision: 3 } });
    const history = screen.getByRole('list', { name: 'Change history (oldest first)' });
    expect(within(history).getByText('Artwork link decided')).toBeInTheDocument();
  });
});
