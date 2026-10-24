/**
 * IsoView in jsdom: the canvas is replaced by a recording context, the
 * container gets a real size, and the read-only test hook (?e2e=1) supplies
 * screen positions. Interaction goes through pointer and keyboard events only.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateStudioMesh } from '../../../src/building-studio/mesh/generate.ts';
import type { IsoController } from '../../../src/isometric/iso-controller.ts';
import { IsoView, type IsoViewProps } from '../../../src/isometric/IsoView.tsx';
import type { IsoStudioModel } from '../../../src/isometric/scene.ts';
import { model } from '../building-studio/fixtures.ts';
import { realData, recordingCtx } from './helpers.ts';

const data = realData();
const W = 1000;
const H = 700;

beforeEach(() => {
  window.history.replaceState(null, '', '/?e2e=1');
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => recordingCtx() as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        left: 0,
        top: 0,
        right: W,
        bottom: H,
        width: W,
        height: H,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect,
  );
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

function setup(over: Partial<IsoViewProps> = {}) {
  const onSelect = vi.fn();
  const onGroundClick = vi.fn();
  const onOpenDirectory = vi.fn();
  let controller: IsoController | null = null;
  const props: IsoViewProps = {
    data,
    theme: 'light',
    reducedMotion: true,
    showLabels: false,
    selectedId: null,
    route: null,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    onSelect,
    onGroundClick,
    onOpenDirectory,
    onReady: (c) => {
      controller = c;
    },
    ...over,
  };
  const utils = render(<IsoView {...props} />);
  const canvas = screen.getByRole('img', { name: /isometric campus overview/i });
  return { ...utils, props, canvas, onSelect, onGroundClick, onOpenDirectory, controller: () => controller! };
}

const hooks = () => window.__ATLAS_ISO__!;
const click = (el: Element, x: number, y: number) => {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: x, clientY: y, button: 0, pointerType: 'mouse' });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: x, clientY: y, button: 0, pointerType: 'mouse' });
};

describe('IsoView', () => {
  it('renders an accessible canvas summary with the directory hint, and installs the e2e hook', () => {
    const { canvas } = setup();
    expect(canvas).toHaveAttribute('tabindex', '0');
    expect(canvas.getAttribute('aria-label')).toMatch(/131 mapped campus buildings/);
    const hint = document.getElementById(canvas.getAttribute('aria-describedby')!)!;
    expect(hint.textContent).toMatch(/Directory/);
    expect(hooks().getDrawOrder()).toHaveLength(131);
    expect(hooks().getFrameStats().fullRedraws).toBeGreaterThan(0);
  });

  it('selects the building under a click (topmost building at its roof anchor)', () => {
    const { canvas, onSelect } = setup();
    const top = hooks().getDrawOrder().at(-1)!;
    const f = data.buildings.features.find((x) => x.properties.id === top)!.properties;
    const p = hooks().projectToViewport([f.anchorLon, f.anchorLat], f.renderHeightM)!;
    click(canvas, p.x, p.y + 0.5);
    expect(onSelect).toHaveBeenLastCalledWith(top);
    expect(hooks().getFrameStats().hitTestMs).toBeGreaterThanOrEqual(0);
  });

  it('a click on empty ground reports the exact ground point and clears the selection', () => {
    const { canvas, onSelect, onGroundClick } = setup();
    click(canvas, 3, 3);
    expect(onSelect).toHaveBeenLastCalledWith(null);
    const [lngLat] = onGroundClick.mock.calls.at(-1)! as [[number, number]];
    const back = hooks().projectToViewport(lngLat)!;
    expect(back.x).toBeCloseTo(3, 6);
    expect(back.y).toBeCloseTo(3, 6);
  });

  it('a drag pans (no selection) and commits the view', () => {
    const { canvas, onSelect } = setup();
    const before = hooks().getView().center;
    fireEvent.pointerDown(canvas, {
      pointerId: 1,
      clientX: 500,
      clientY: 350,
      button: 0,
      pointerType: 'mouse',
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 1,
      clientX: 600,
      clientY: 300,
      button: 0,
      pointerType: 'mouse',
    });
    fireEvent.pointerUp(canvas, {
      pointerId: 1,
      clientX: 600,
      clientY: 300,
      button: 0,
      pointerType: 'mouse',
    });
    expect(onSelect).not.toHaveBeenCalled();
    expect(hooks().getView().center).not.toEqual(before);
  });

  it('keyboard: arrows pan, +/− zoom, R rotates, D opens the directory', () => {
    const { canvas, onOpenDirectory } = setup();
    const v0 = hooks().getView();
    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    expect(hooks().getView().center).not.toEqual(v0.center);
    fireEvent.keyDown(canvas, { key: '+' });
    expect(hooks().getView().pxPerMetre).toBeGreaterThan(v0.pxPerMetre);
    fireEvent.keyDown(canvas, { key: 'r' });
    expect(hooks().getView().rotation).toBe((v0.rotation + 1) % 4);
    expect(screen.getByText(/^Top: /)).toBeInTheDocument();
    fireEvent.keyDown(canvas, { key: 'd' });
    expect(onOpenDirectory).toHaveBeenCalledTimes(1);
  });

  it('rotation buttons rotate in 90° steps', () => {
    setup();
    const r0 = hooks().getView().rotation;
    fireEvent.click(screen.getByRole('button', { name: 'Rotate view right' }));
    expect(hooks().getView().rotation).toBe((r0 + 1) % 4);
    fireEvent.click(screen.getByRole('button', { name: 'Rotate view left' }));
    expect(hooks().getView().rotation).toBe(r0);
  });

  it('the legend explains map keys and placeholder heights, collapsed by default', () => {
    setup();
    const toggle = screen.getByRole('button', { name: 'Show legend' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Hide legend' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/not official LPU block numbers/)).toBeVisible();
    expect(screen.getByText(/placeholder height/i)).toBeVisible();
  });

  it('the info panel names the selected building honestly, with its map key and height note', () => {
    const f = data.buildings.features.find(
      (x) => x.properties.name === null && x.properties.directoryKey,
    )!.properties;
    setup({ selectedId: f.id });
    const card = screen.getByRole('region', { name: 'Selected building' });
    expect(card).toHaveTextContent(`Building ${f.directoryKey}`);
    expect(card).toHaveTextContent(f.displayName);
    expect(card).toHaveTextContent(/not an official block number/);
    expect(card).toHaveTextContent(/Height estimated from the floor count|Placeholder height/);
    expect(hooks().getSelectedId()).toBe(f.id);
  });

  it('draws an owner model in place of its building and labels it "illustrative" (S3)', () => {
    const f = data.buildings.features[0]!.properties;
    const res = generateStudioMesh(model({ anchor: [f.anchorLon, f.anchorLat] }));
    if (!res.ok) throw new Error(res.message);
    const studio: IsoStudioModel = {
      id: f.id,
      mesh: res.mesh,
      verificationLabel: 'Illustrative model placed by the site owner — not verified',
      appearanceLabel: 'Colours and materials are appearance only',
    };
    setup({ selectedId: f.id, studioModels: [studio] });
    const card = screen.getByRole('region', { name: 'Selected building' });
    expect(card).toHaveTextContent('Illustrative model placed by the site owner — not verified');
    expect(card).toHaveTextContent('Colours and materials are appearance only');
    // Still one building record with the same id.
    expect(
      hooks()
        .getDrawOrder()
        .filter((id) => id === f.id),
    ).toHaveLength(1);
  });

  it('animates nothing with reduced motion: flyTo jumps straight to the target', () => {
    const { controller } = setup({ reducedMotion: true });
    act(() => controller().flyTo([75.705, 31.255], 17));
    expect(hooks().getView().center).toEqual([75.705, 31.255]);
    expect(hooks().getFrameStats().fullRedraws).toBeGreaterThan(1);
  });
});
