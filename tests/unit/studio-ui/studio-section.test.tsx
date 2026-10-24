/**
 * The Studio workspace in the DOM (RTL): MapView is replaced by a stub that
 * records the editing props (WebGL is not available in jsdom), the campus
 * data is the real public/data, and the server is a scripted StudioApi.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminServices } from '../../../src/admin/context.ts';
import type { AdminApi } from '../../../src/admin/api/index.ts';
import type { AdminSectionProps } from '../../../src/admin/sections/types.ts';
import { starterLibrary } from '../../../src/building-studio/asset-library.ts';
import { createEnuFrame } from '../../../src/building-studio/geometry.ts';
import { saveRecovery } from '../../../src/building-studio/local-recovery.ts';
import type { MapEditingProps } from '../../../src/map/editing/types.ts';
import type { MapViewProps } from '../../../src/map/types.ts';
import { ANCHOR, draft, STU_ID } from '../building-studio/fixtures.ts';
import { realData } from '../building-studio/real-data.ts';
import {
  CROSSING_VALIDATION,
  detail,
  EMPTY_VALIDATION,
  fakeStudioApi,
  head,
  ok,
  problem,
} from './studio-fakes.ts';

const mapProps: { current: MapViewProps | null } = { current: null };

vi.mock('../../../src/map/index.ts', () => ({
  MapView: (props: MapViewProps) => {
    mapProps.current = props;
    return <div data-testid="atlas-map" />;
  },
}));
vi.mock('../../../src/app/maplibre-worker.ts', () => ({}));
vi.mock('../../../src/admin/studio/useStudioMapData.ts', () => ({
  useStudioMapData: () => ({
    status: 'ready',
    data: realData().campus,
    studioModels: [],
    optional: {
      detections: () => Promise.reject(new Error('not in tests')),
      boundaryReview: () => Promise.reject(new Error('not in tests')),
      contextPlaces: () => Promise.resolve([]),
    },
    publicationNote: null,
    refresh: () => undefined,
  }),
}));

const { AdminContext } = await import('../../../src/admin/context.ts');
const { default: StudioSection } = await import('../../../src/admin/studio/StudioSection.tsx');

function setup(id: string | null = null, configure?: (studio: ReturnType<typeof fakeStudioApi>) => void) {
  const studio = fakeStudioApi();
  studio.library.mockResolvedValue(
    ok({
      templates: starterLibrary().map((e) => ({
        source: 'code' as const,
        status: 'active' as const,
        definition: e.definition,
        versions: [e.definition.version],
        revision: null,
      })),
    }),
  );
  configure?.(studio);
  const navigate = vi.fn();
  const services = { api: { studio } as unknown as AdminApi, session: {} as never } as AdminServices;
  const route: AdminSectionProps['route'] = { section: 'studio', id, query: {} };
  const view = render(
    <AdminContext value={services}>
      <StudioSection route={route} navigate={navigate} />
    </AdminContext>,
  );
  return { ...view, studio, navigate, user: userEvent.setup() };
}

const editing = (): MapEditingProps => {
  const e = mapProps.current?.editing;
  if (!e) throw new Error('MapView got no editing props');
  return e;
};
const state = () => screen.getByTestId('studio-state');

function mockMobile(mobile: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (q: string) => ({
      matches: mobile && q.includes('max-width'),
      media: q,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

beforeEach(() => {
  mapProps.current = null;
  // A desktop window: both side panels start open.
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1440 });
  window.localStorage.clear();
  mockMobile(false);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function placeAcademic(t: ReturnType<typeof setup>) {
  await t.user.click(await screen.findByTestId('studio-template-academic-block'));
  await t.user.click(screen.getByTestId('studio-place-template'));
}

describe('Studio workspace (desktop)', () => {
  it('library: 17 templates with generated thumbnails, honest badges and search', async () => {
    const t = setup();
    const list = await screen.findByRole('list', { name: 'Templates' });
    expect(within(list).getAllByRole('button')).toHaveLength(17);
    expect(within(list).getAllByText('Generic prefab')).toHaveLength(17);
    expect(list.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    await t.user.type(screen.getByRole('searchbox', { name: 'Search templates' }), 'hostel');
    expect(
      within(list)
        .getAllByRole('button')
        .map((b) => b.dataset.testid),
    ).toContain('studio-template-hostel-multistorey');
    expect(within(list).getAllByRole('button').length).toBeLessThan(17);
    expect(state()).toHaveTextContent('Nothing open');
  });

  it('placement preview → click to position → confirm → unsaved → Save draft creates it', async () => {
    const t = setup();
    await placeAcademic(t);
    expect(state()).toHaveTextContent('Placing (preview only, nothing saved)');
    expect(screen.getByTestId('studio-placement')).toHaveTextContent('Preview only: nothing is saved yet.');
    expect(editing().input).toBe('pointer');
    expect(editing().previewModel).toMatchObject({ preview: true, version: 0 });
    expect(editing().handles.map((h) => h.kind)).toEqual([
      'move',
      'rotate',
      'resize',
      'resize',
      'resize',
      'resize',
    ]);
    // Map clicks go to the editor (never select a place) and move the preview.
    const target = createEnuFrame(ANCHOR).toLngLat([40, 0]);
    act(() => editing().onPointer?.({ type: 'click', lngLat: target, placeId: 'osm:way/1' }));
    expect((screen.getByTestId('studio-place-lon') as HTMLInputElement).value).toBe(
      // Coordinate fields show 5 decimals (their 0.00001° step, about 1 m).
      String(Math.round(target[0] * 1e5) / 1e5),
    );
    // The server check of the would-be draft runs on its own.
    await waitFor(() => expect(t.studio.validate).toHaveBeenCalled());
    await screen.findByText(/No problems here \(checked by the server\)/);
    await t.user.click(screen.getByTestId('studio-confirm-placement'));
    expect(state()).toHaveTextContent('Unsaved local changes (not on the server yet)');
    // The beforeunload guard is active while unsaved.
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    t.studio.createBuilding.mockImplementation(async (body: { draft: ReturnType<typeof draft> }) =>
      ok(detail({}, body.draft), 201),
    );
    await t.user.click(screen.getByTestId('studio-save'));
    await waitFor(() => expect(state()).toHaveTextContent('Saved draft (rev 1)'));
    expect(t.navigate).toHaveBeenCalledWith({ section: 'studio', id: STU_ID });
    const ev2 = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev2);
    expect(ev2.defaultPrevented).toBe(false);
  });

  it('a failed save is shown as a failure and the state stays unsaved', async () => {
    const t = setup();
    await placeAcademic(t);
    await t.user.click(screen.getByTestId('studio-confirm-placement'));
    t.studio.createBuilding.mockResolvedValue(problem(500, 'internal', 'Internal error'));
    await t.user.click(screen.getByTestId('studio-save'));
    const alert = await screen.findByTestId('studio-error');
    expect(alert).toHaveTextContent('Not saved.');
    expect(alert).toHaveTextContent('Your local draft is kept; you can try again.');
    expect(state()).toHaveTextContent('Unsaved local changes');
    expect(screen.queryByTestId('studio-notice')).toBeNull();
  });

  it('a handle drag is one undo command and never selects a place', async () => {
    const t = setup(STU_ID, (api) =>
      api.getBuilding.mockResolvedValue(ok(detail({ validation: EMPTY_VALIDATION }))),
    );
    await waitFor(() => expect(state()).toHaveTextContent('Saved draft (rev 1)'));
    await t.user.click(screen.getByTestId('studio-tool-move'));
    expect(editing().handles.map((h) => h.id)).toEqual(['move']);
    expect(mapProps.current?.selectedPlaceId).toBeNull();
    const start = ANCHOR;
    const e = (phase: 'start' | 'move' | 'end', east: number) => ({
      handleId: 'move',
      kind: 'move' as const,
      phase,
      start,
      current: createEnuFrame(ANCHOR).toLngLat([east, 0]),
      modifiers: { shift: false, alt: false },
    });
    act(() => {
      editing().onHandleDrag?.(e('start', 0));
      editing().onHandleDrag?.(e('move', 3));
      editing().onHandleDrag?.(e('move', 6));
      editing().onHandleDrag?.(e('end', 9));
    });
    expect(state()).toHaveTextContent('Unsaved local changes');
    expect(screen.getByTestId('studio-undo')).toHaveAttribute('title', 'Undo: Drag move');
    await t.user.click(screen.getByTestId('studio-undo'));
    expect(state()).toHaveTextContent('Saved draft (rev 1)');
    expect(screen.getByTestId('studio-undo')).toBeDisabled();
    // Keyboard redo (outside text fields).
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(state()).toHaveTextContent('Unsaved local changes');
  });

  it('publish dialog: change summary + one acknowledgement per warning, then the server confirms', async () => {
    const t = setup(STU_ID, (api) =>
      api.getBuilding.mockResolvedValue(ok(detail({ validation: CROSSING_VALIDATION }))),
    );
    await waitFor(() => expect(screen.getByTestId('studio-publish')).toBeEnabled());
    await t.user.click(screen.getByTestId('studio-publish'));
    const dialog = await screen.findByRole('dialog', { name: 'Publish this building' });
    expect(within(dialog).getByTestId('studio-change-list')).toHaveTextContent(
      'First publication of this building.',
    );
    expect(dialog).toHaveTextContent('0 of 1 acknowledged');
    const confirm = within(dialog).getByTestId('studio-confirm-publish');
    expect(confirm).toBeDisabled();
    await t.user.type(within(dialog).getByTestId('studio-change-summary'), 'First publication');
    expect(confirm).toBeDisabled();
    await t.user.type(
      within(dialog).getByTestId('studio-ack-boundary-crossing'),
      'Canopy over the road edge',
    );
    expect(dialog).toHaveTextContent('1 of 1 acknowledged');
    // A published building's detail carries the published record (the draft is cleared).
    t.studio.publish.mockResolvedValue(
      ok({
        building: {
          ...detail({
            head: head({ status: 'published', revision: 2, hasDraft: false, publishedVersion: 1 }),
            draft: null,
          }),
          published: {
            version: 1,
            record: draft(),
            footprint: {
              type: 'Polygon',
              coordinates: [[ANCHOR, [ANCHOR[0] + 0.001, ANCHOR[1]], [ANCHOR[0], ANCHOR[1] + 0.001], ANCHOR]],
            },
            footprintAreaM2: 100,
            membership: {
              campusStatus: 'crossing',
              insideFraction: 0.8,
              distanceToBoundaryM: 0,
              reasonCode: 'crossing-majority',
              decision: 'auto',
              decisionSource: null,
            },
            acknowledgements: [{ code: 'boundary-crossing', reason: 'Canopy over the road edge' }],
            changeSummary: 'First publication',
            publishedBy: 'owner',
            publishedAt: '2026-10-24T10:00:00.000Z',
          },
        },
        publicationVersion: 9,
      }),
    );
    await t.user.click(confirm);
    await waitFor(() => expect(state()).toHaveTextContent('Published (version 1)'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(t.studio.publish).toHaveBeenCalledWith(STU_ID, {
      revision: 1,
      acknowledgements: [{ code: 'boundary-crossing', reason: 'Canopy over the road edge' }],
      changeSummary: 'First publication',
    });
  });

  it('offers crash recovery of unsaved edits for the opened record', async () => {
    const mine = draft({ model: { ...draft().model, heightM: 30 } });
    saveRecovery(STU_ID, mine, { baseRevision: 1 });
    const t = setup(STU_ID, (api) => api.getBuilding.mockResolvedValue(ok(detail())));
    const banner = await screen.findByTestId('studio-recovery');
    expect(banner).toHaveTextContent('Unsaved changes recovered from this browser — not saved on the server');
    await t.user.click(within(banner).getByRole('button', { name: 'Restore them' }));
    expect(state()).toHaveTextContent('Unsaved local changes');
    expect(screen.getByTestId('studio-dim-heightM')).toHaveValue('30');
  });

  it('the Google Maps rule is explained at the citation field', async () => {
    const t = setup(STU_ID, (api) => api.getBuilding.mockResolvedValue(ok(detail())));
    await waitFor(() => expect(state()).toHaveTextContent('Saved draft (rev 1)'));
    await t.user.selectOptions(screen.getByLabelText('Evidence for this building'), 'source-backed');
    await t.user.type(screen.getByTestId('studio-citation-url'), 'https://maps.google.com/?q=lpu');
    expect(screen.getByTestId('studio-citation-url')).toHaveAccessibleDescription(/Google Maps/);
  });
});

describe('Studio workspace (narrow desktop)', () => {
  it('a tablet-width window starts with the side panels collapsed; they open on request', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 800 });
    const t = setup();
    expect(document.getElementById('studio-left-panel')).not.toBeVisible();
    expect(document.getElementById('studio-inspector')).not.toBeVisible();
    await t.user.click(screen.getByRole('button', { name: 'Show the library panel' }));
    expect(document.getElementById('studio-left-panel')).toBeVisible();
  });
});

describe('Studio workspace (phone)', () => {
  it('centre-reticle placement, step buttons, bottom-sheet properties and large Save / Cancel', async () => {
    mockMobile(true);
    const t = setup();
    expect(screen.getByTestId('studio-workspace')).toHaveAttribute('data-layout', 'mobile');
    await t.user.click(screen.getByRole('button', { name: 'Library' }));
    await placeAcademic(t);
    expect(editing().input).toBe('reticle');
    expect(editing().handles).toEqual([]);
    const centre = createEnuFrame(ANCHOR).toLngLat([0, 25]);
    act(() => editing().onReticleChange?.(centre));
    await t.user.click(screen.getByTestId('studio-confirm-placement'));
    expect(editing().input).toBe('pointer');
    const dock = screen.getByTestId('studio-mobile-dock');
    expect(within(dock).getByTestId('studio-mobile-save')).toBeEnabled();
    await t.user.click(within(dock).getByRole('button', { name: 'Move / rotate / size' }));
    const lat0 = Number((editing().previewModel?.model as unknown as { anchor: number[] }).anchor[1]);
    // Label in name (WCAG 2.5.3, axe label-content-name-mismatch): each move button's visible
    // word, without its decorative arrow, is part of its accessible name.
    for (const dir of ['west', 'north', 'south', 'east']) {
      const b = screen.getByRole('button', { name: `Move 1 m ${dir}` });
      const visible = [...b.childNodes]
        .filter((n) => !(n instanceof Element && n.getAttribute('aria-hidden') === 'true'))
        .map((n) => n.textContent)
        .join('')
        .trim();
      expect(visible.toLowerCase()).toBe(dir);
    }
    for (const b of [
      screen.getByRole('button', { name: /increase width by 1 m/ }),
      screen.getByRole('button', { name: /decrease length by 1 m/ }),
    ])
      expect(b.getAttribute('aria-label')!.startsWith(b.textContent!.trim())).toBe(true);
    await t.user.click(screen.getByRole('button', { name: 'Move 1 m north' }));
    const lat1 = Number((editing().previewModel?.model as unknown as { anchor: number[] }).anchor[1]);
    expect(lat1).toBeGreaterThan(lat0);
    await t.user.click(within(dock).getByTestId('studio-open-properties'));
    expect(await screen.findByRole('region', { name: 'Properties' })).toBeInTheDocument();
  });
});
