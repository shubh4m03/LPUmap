/**
 * The illustrated overview and its detail card as components (jsdom): one
 * layer carries the image AND the outlines under one transform; outlines are
 * focusable in keyboard order with exact names; Enter, a click and a tap
 * select through hit-testing in source px; wheel zoom keeps the pixel under
 * the cursor; the card keeps artwork labels and official fields apart and
 * offers map actions by association status only.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ArtworkDetailCard,
  type LinkedBuildingInfo,
} from '../../../src/isometric-art/view/ArtworkDetailCard.tsx';
import { ArtworkLegend } from '../../../src/isometric-art/view/ArtworkLegend.tsx';
import { LEGEND_CROP } from '../../../src/isometric-art/view/art-ui.ts';
import { IllustratedOverview } from '../../../src/isometric-art/view/IllustratedOverview.tsx';
import {
  initialTransform,
  NO_INSETS,
  parseTransformCss,
  screenToSource,
  snapToDevicePixels,
  sourceToScreen,
  transformCss,
} from '../../../src/isometric-art/viewport.ts';
import { loadManifest, modelOf } from './renderer-fixtures.ts';

const manifest = loadManifest();
const model = modelOf(manifest);
const VP = { width: 390, height: 844 };

function rect(width: number, height: number): DOMRect {
  return {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width,
    height,
    right: width,
    bottom: height,
    toJSON: () => ({}),
  } as DOMRect;
}

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(VP.width, VP.height));
  vi.stubGlobal('devicePixelRatio', 2);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function layerTransform() {
  const css = screen.getByTestId('art-layer').style.transform;
  const t = parseTransformCss(css);
  if (!t) throw new Error(`no transform: ${css}`);
  return t;
}

function renderOverview(onSelect = vi.fn(), selected: string[] = []) {
  const utils = render(
    <IllustratedOverview
      model={model}
      reducedMotion
      padding={NO_INSETS}
      selectedSubjectIds={selected}
      onSelectSubject={onSelect}
    />,
  );
  return { ...utils, onSelect };
}

describe('IllustratedOverview', () => {
  it('puts the image files and the outlines in ONE layer with ONE transform (the opening view)', () => {
    renderOverview();
    const layer = screen.getByTestId('art-layer');
    const imgs = layer.querySelectorAll('img[data-art-purpose]');
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) expect(img.parentElement).toBe(layer);
    expect(screen.getByTestId('art-outlines').parentElement).toBe(layer);
    expect(layer.style.width).toBe('3371px');
    expect(layer.style.height).toBe('2384px');
    const expected = snapToDevicePixels(initialTransform(VP, model.space, NO_INSETS, model.focusRect), 2);
    expect(layer.style.transform).toBe(transformCss(expected));
    // No transform anywhere else between the stage and the image / outlines.
    for (const img of imgs) expect((img as HTMLElement).style.transform).toBe('');
  });

  it('every outline is a focusable button with its exact name, in keyboard order', () => {
    renderOverview();
    const polys = screen.getByTestId('art-outlines').querySelectorAll('polygon[data-hotspot-id]');
    expect(polys).toHaveLength(model.hotspots.length);
    polys.forEach((p, i) => {
      expect(p.getAttribute('tabindex')).toBe('0');
      expect(p.getAttribute('role')).toBe('button');
      expect(p.getAttribute('aria-label')).toBe(model.hotspots[i]!.name);
    });
    const fashion = model.hotspots.find((h) => h.hotspot.hotspotId === 'hs-pin-1')!;
    expect(screen.getByRole('button', { name: fashion.name })).toBeInTheDocument();
  });

  it('Enter or Space on a focused outline selects its subject; Escape clears', () => {
    const { onSelect, rerender } = renderOverview();
    const h = model.byHotspot.get('hs-pin-25')!;
    const poly = screen.getByRole('button', { name: h.name });
    act(() => poly.focus());
    fireEvent.keyDown(poly, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith('art:num-25');
    fireEvent.keyDown(poly, { key: ' ' });
    expect(onSelect).toHaveBeenCalledTimes(2);
    rerender(
      <IllustratedOverview
        model={model}
        reducedMotion
        padding={NO_INSETS}
        selectedSubjectIds={['art:num-25']}
        onSelectSubject={onSelect}
      />,
    );
    expect(poly.getAttribute('aria-pressed')).toBe('true');
    expect(
      screen.getByTestId('art-selection').querySelector('[data-selected-hotspot-id="hs-pin-25"]'),
    ).not.toBeNull();
    fireEvent.keyDown(screen.getByTestId('art-stage'), { key: 'Escape' });
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('a click selects the outline under it through the shared transform (hit-test in source px)', () => {
    const { onSelect } = renderOverview();
    const stage = screen.getByTestId('art-stage');
    const t = layerTransform();
    for (const id of ['hs-pin-15', 'hs-scene-pavilion']) {
      const h = model.byHotspot.get(id)!;
      const p = sourceToScreen(t, h.geometry.anchor.x, h.geometry.anchor.y);
      fireEvent.pointerDown(stage, {
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        clientX: p.x,
        clientY: p.y,
      });
      fireEvent.pointerUp(stage, {
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        clientX: p.x,
        clientY: p.y,
      });
      expect(onSelect).toHaveBeenLastCalledWith(h.subjectId);
    }
    // Empty artwork (the INFORMATION panel) clears the selection.
    const empty = sourceToScreen(t, 3000, 300);
    if (empty.x >= 0 && empty.x <= VP.width && empty.y >= 0 && empty.y <= VP.height) {
      fireEvent.pointerDown(stage, {
        pointerId: 2,
        pointerType: 'mouse',
        button: 0,
        clientX: empty.x,
        clientY: empty.y,
      });
      fireEvent.pointerUp(stage, {
        pointerId: 2,
        pointerType: 'mouse',
        button: 0,
        clientX: empty.x,
        clientY: empty.y,
      });
      expect(onSelect).toHaveBeenLastCalledWith(null);
    }
  });

  it('a drag pans (no selection) and moves image and outlines together', () => {
    const { onSelect } = renderOverview();
    const stage = screen.getByTestId('art-stage');
    const before = layerTransform();
    fireEvent.pointerDown(stage, { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 400 });
    fireEvent.pointerMove(stage, { pointerId: 1, pointerType: 'touch', clientX: 170, clientY: 360 });
    fireEvent.pointerUp(stage, { pointerId: 1, pointerType: 'touch', clientX: 170, clientY: 360 });
    const after = layerTransform();
    expect(onSelect).not.toHaveBeenCalled();
    expect(after.scale).toBe(before.scale);
    expect(after.tx).toBeCloseTo(before.tx - 30, 0);
    expect(after.ty).toBeCloseTo(before.ty - 40, 0);
  });

  it('a tap selects on pointerup and cancels the click synthesized from the touch (no ghost click on a card opened under the finger)', () => {
    const { onSelect } = renderOverview();
    const stage = screen.getByTestId('art-stage');
    const h = model.byHotspot.get('hs-pin-15')!;
    const p = sourceToScreen(layerTransform(), h.geometry.anchor.x, h.geometry.anchor.y);
    const img = screen.getByTestId('art-layer').querySelector('img[data-art-purpose]')!;
    fireEvent.pointerDown(img, { pointerId: 7, pointerType: 'touch', clientX: p.x, clientY: p.y });
    fireEvent.pointerUp(stage, { pointerId: 7, pointerType: 'touch', clientX: p.x, clientY: p.y });
    expect(onSelect).toHaveBeenLastCalledWith(h.subjectId);
    // fireEvent returns false when a listener called preventDefault(): the browser then sends no
    // compatibility mouse events and no click, which would otherwise hit whatever now lies under the finger.
    expect(fireEvent.touchEnd(img, { changedTouches: [{ clientX: p.x, clientY: p.y }] })).toBe(false);
  });

  it('wheel zoom keeps the source pixel under the cursor', () => {
    renderOverview();
    const stage = screen.getByTestId('art-stage');
    const before = layerTransform();
    const at = { x: 150, y: 500 };
    const src = screenToSource(before, at.x, at.y);
    fireEvent.wheel(stage, { deltaY: -200, deltaMode: 0, clientX: at.x, clientY: at.y });
    const after = layerTransform();
    expect(after.scale).toBeGreaterThan(before.scale);
    const p = sourceToScreen(after, src.x, src.y);
    // ±1 device px from snapping.
    expect(Math.abs(p.x - at.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(p.y - at.y)).toBeLessThanOrEqual(0.5);
  });

  it('keyboard pans and zooms the shared layer; 0 returns to the opening view', () => {
    renderOverview();
    const stage = screen.getByTestId('art-stage');
    const open = layerTransform();
    fireEvent.keyDown(stage, { key: 'ArrowRight' });
    expect(layerTransform().tx).toBeLessThan(open.tx);
    fireEvent.keyDown(stage, { key: '+' });
    expect(layerTransform().scale).toBeGreaterThan(open.scale);
    fireEvent.keyDown(stage, { key: '0' });
    expect(layerTransform()).toEqual(open);
  });

  it('shows the not-to-scale notice and states the disclaimer to screen readers', () => {
    renderOverview();
    expect(screen.getByTestId('art-notice')).toHaveTextContent(
      'Illustration — not to scale; positions are schematic',
    );
    expect(screen.getByText(/not geographically exact/)).toBeInTheDocument();
  });
});

describe('IllustratedOverview motion and hover', () => {
  const frame = () => new Promise((r) => setTimeout(r, 20));

  it('hovering an outline with a mouse draws it; leaving clears it', () => {
    renderOverview();
    const stage = screen.getByTestId('art-stage');
    const h = model.byHotspot.get('hs-pin-15')!;
    const p = sourceToScreen(layerTransform(), h.geometry.anchor.x, h.geometry.anchor.y);
    fireEvent.pointerMove(stage, { pointerId: 1, pointerType: 'mouse', clientX: p.x, clientY: p.y });
    const poly = screen.getByTestId('art-outlines').querySelector('[data-hotspot-id="hs-pin-15"]')!;
    expect(poly.getAttribute('class')).toContain('is-hover');
    fireEvent.pointerLeave(stage, { pointerId: 1, pointerType: 'mouse' });
    expect(poly.getAttribute('class')).not.toContain('is-hover');
  });

  it('without reduced motion a keyboard pan animates to the same end point; with it, it jumps', async () => {
    render(
      <IllustratedOverview
        model={model}
        reducedMotion={false}
        padding={NO_INSETS}
        selectedSubjectIds={[]}
        onSelectSubject={vi.fn()}
      />,
    );
    const stage = screen.getByTestId('art-stage');
    const open = layerTransform();
    fireEvent.keyDown(stage, { key: 'ArrowDown' });
    // Not there yet on the same frame.
    expect(layerTransform().ty).toBe(open.ty);
    for (let i = 0; i < 30 && layerTransform().ty === open.ty; i++) await frame();
    for (let i = 0; i < 30; i++) await frame();
    const animated = layerTransform();
    expect(animated.ty).toBeLessThan(open.ty);
    cleanup();

    renderOverview();
    const stage2 = screen.getByTestId('art-stage');
    fireEvent.keyDown(stage2, { key: 'ArrowDown' });
    expect(layerTransform().ty).toBeCloseTo(animated.ty, 0);
  });

  it('a selection hidden by the card is panned into view; clearing it removes any empty band', async () => {
    // jsdom has no layout: give the card wrapper (bottom 300 px) and the switch/notice block (top 60 px) their rects.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.textContent === 'card')
        return { ...rect(VP.width, 300), top: 544, y: 544, bottom: 844 } as DOMRect;
      if (
        this.querySelector?.('[data-testid="art-notice"]') &&
        !this.querySelector('[data-testid="art-stage"]')
      )
        return { ...rect(VP.width, 48), top: 12, y: 12, bottom: 60 } as DOMRect;
      return rect(VP.width, VP.height);
    });
    const card = <div>card</div>;
    const { rerender } = render(
      <IllustratedOverview
        model={model}
        reducedMotion
        padding={NO_INSETS}
        selectedSubjectIds={[]}
        onSelectSubject={vi.fn()}
      />,
    );
    const open = layerTransform();
    rerender(
      <IllustratedOverview
        model={model}
        reducedMotion
        padding={NO_INSETS}
        selectedSubjectIds={['art:num-58']}
        onSelectSubject={vi.fn()}
        card={card}
      />,
    );
    for (let i = 0; i < 5; i++) await frame();
    // Bottom-anchored on a phone: marked so the toast stack is lifted above it.
    expect(screen.getByText('card').parentElement).toHaveAttribute('data-toast-clearance');
    const h = model.byHotspot.get('hs-pin-58')!;
    const t = layerTransform();
    // Pin 58 sits at the artwork's top-left: it is now inside the stage.
    const a = sourceToScreen(t, h.geometry.bbox.x, h.geometry.bbox.y);
    const b = sourceToScreen(
      t,
      h.geometry.bbox.x + h.geometry.bbox.width,
      h.geometry.bbox.y + h.geometry.bbox.height,
    );
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.y).toBeGreaterThanOrEqual(0);
    expect(b.x).toBeLessThanOrEqual(VP.width);
    expect(b.y).toBeLessThanOrEqual(VP.height);
    rerender(
      <IllustratedOverview
        model={model}
        reducedMotion
        padding={NO_INSETS}
        selectedSubjectIds={[]}
        onSelectSubject={vi.fn()}
      />,
    );
    for (let i = 0; i < 5; i++) await frame();
    const after = layerTransform();
    expect(after.scale).toBe(open.scale);
    // The artwork covers the stage edge to edge again (no empty band).
    expect(after.tx).toBeLessThanOrEqual(0);
    expect(after.ty).toBeLessThanOrEqual(0);
    expect(after.tx + 3371 * after.scale).toBeGreaterThanOrEqual(VP.width);
    expect(after.ty + 2384 * after.scale).toBeGreaterThanOrEqual(VP.height);
  });
});

describe('ArtworkLegend', () => {
  it('shows a crop of the original artwork (no new file) and lists the exact printed labels', () => {
    render(
      <ArtworkLegend imageUrl="/isometric-art/x.webp" space={model.space} labels={['ROAD', 'PEDISTRIAN']} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show legend' }));
    const img = screen.getByTestId('art-legend-crop');
    expect(img.getAttribute('src')).toBe('/isometric-art/x.webp');
    const k = 240 / LEGEND_CROP.width;
    expect(parseFloat(img.style.left)).toBeCloseTo(-LEGEND_CROP.x * k, 6);
    expect(parseFloat(img.style.width)).toBeCloseTo(3371 * k, 6);
    expect(parseFloat(img.style.height)).toBeCloseTo(2384 * k, 6);
    expect(screen.getByRole('img', { name: /ROAD, PEDISTRIAN/ })).toBeInTheDocument();
  });
});

describe('ArtworkDetailCard', () => {
  const handlers = () => ({
    onClose: vi.fn(),
    onSelectSubject: vi.fn(),
    onShowOnMap: vi.fn(),
    onDirections: vi.fn(),
    onShowUnconfirmedMatch: vi.fn(),
    linkedBuilding: vi.fn((): LinkedBuildingInfo => ({
      mapName: 'Mapped Hall',
      officialName: null,
      officialBlockLabel: null,
    })),
  });
  const approx = manifest.associations.find((a) => a.status === 'approximate')!;

  it('approximate: exact labels, "Unconfirmed match", no directions, official fields not verified', () => {
    const h = handlers();
    render(<ArtworkDetailCard model={model} subjectId={approx.subjectId} {...h} />);
    const card = screen.getByTestId('art-detail-card');
    expect(within(card).getByTestId('art-association-badge')).toHaveTextContent('Unconfirmed match');
    expect(within(card).queryByRole('button', { name: /Directions/ })).toBeNull();
    expect(within(card).getByTestId('art-official-name')).toHaveTextContent('Not verified');
    expect(within(card).getByTestId('art-official-block')).toHaveTextContent('Not verified');
    fireEvent.click(within(card).getByRole('button', { name: 'Show unconfirmed match on map' }));
    expect(h.onShowUnconfirmedMatch).toHaveBeenCalledWith(approx.buildingId);
    expect(h.linkedBuilding).not.toHaveBeenCalled();
  });

  it('numbered subject: exact caption and block heading as printed, number note, original vignette linked', () => {
    render(<ArtworkDetailCard model={model} subjectId="art:num-25" {...handlers()} />);
    const s = manifest.subjects.find((x) => x.subjectId === 'art:num-25')!;
    const labels = screen.getAllByTestId('art-exact-label').map((e) => e.textContent);
    expect(labels).toContain(s.displayLabel!.text);
    expect(labels).toContain(s.visibleBlockLabel!.text);
    expect(screen.getByText(/not an official LPU block number/)).toBeInTheDocument();
    const vignette = screen.getByTestId('art-vignette');
    const asset = manifest.assets.find((a) => a.assetId === s.vignetteAssetIds[0])!;
    expect(vignette.getAttribute('src')).toBe(`/isometric-art/${asset.original!.url}`);
    expect(screen.getByRole('link', { name: /Open the original file/ }).getAttribute('href')).toBe(
      `/isometric-art/${asset.original!.url}`,
    );
  });

  it('keeps printed double spaces visible in the title and the exact labels (white-space: pre-wrap)', () => {
    // 'CAMPUS CAFE  & …' (pin 2) and 'OFFICE OF THE PRO-CHANCELLOR  I) …' (pin 29) print two spaces;
    // HTML's default white-space would collapse them on screen.
    for (const id of ['art:num-2', 'art:num-29']) {
      cleanup();
      render(<ArtworkDetailCard model={model} subjectId={id} {...handlers()} />);
      const s = manifest.subjects.find((x) => x.subjectId === id)!;
      expect(s.displayLabel!.text).toMatch(/ {2}/);
      const title = screen.getByTestId('art-detail-title');
      expect(title.textContent).toBe(s.displayLabel!.text);
      expect(title.className.split(' ')).toContain('whitespace-pre-wrap');
      const caption = screen
        .getAllByTestId('art-exact-label')
        .find((e) => e.textContent === s.displayLabel!.text)!;
      expect(caption.className.split(' ')).toContain('whitespace-pre-wrap');
    }
  });

  it('verified: directions and "Show on map"; official fields come from the linked map record', () => {
    const verifiedModel = modelOf(manifest, [
      {
        subjectId: approx.subjectId,
        status: 'verified',
        buildingId: approx.buildingId,
        evidence: [{ kind: 'owner-statement', description: 'Owner confirmed', date: '2026-10-24' }],
        revision: 2,
        updatedAt: '2026-10-24T10:00:00Z',
      },
    ]);
    const h = handlers();
    render(<ArtworkDetailCard model={verifiedModel} subjectId={approx.subjectId} {...h} />);
    expect(screen.getByTestId('art-association-badge')).toHaveTextContent('Verified link to the map');
    // The map's display name is shown as the MAP building, never as an official name.
    expect(screen.getByTestId('art-map-building')).toHaveTextContent('Mapped Hall');
    expect(screen.getByTestId('art-official-name')).toHaveTextContent('Not verified');
    expect(screen.getByTestId('art-official-block')).toHaveTextContent('Not recorded');
    fireEvent.click(screen.getByRole('button', { name: 'Directions' }));
    expect(h.onDirections).toHaveBeenCalledWith(approx.buildingId);
    fireEvent.click(screen.getByRole('button', { name: 'Show on map' }));
    expect(h.onShowOnMap).toHaveBeenCalledWith(approx.buildingId);
    expect(screen.queryByRole('button', { name: /unconfirmed/ })).toBeNull();
  });

  it('verified with a cited official name: shown as the official name, separate from the map name', () => {
    const verifiedModel = modelOf(manifest, [
      {
        subjectId: approx.subjectId,
        status: 'verified',
        buildingId: approx.buildingId,
        evidence: [{ kind: 'owner-statement', description: 'Owner confirmed', date: '2026-10-24' }],
        revision: 2,
        updatedAt: '2026-10-24T10:00:00Z',
      },
    ]);
    const h = handlers();
    h.linkedBuilding.mockReturnValue({
      mapName: 'Central Library',
      officialName: 'Central Library',
      officialBlockLabel: 'Block 37',
    });
    render(<ArtworkDetailCard model={verifiedModel} subjectId={approx.subjectId} {...h} />);
    expect(screen.getByTestId('art-official-name')).toHaveTextContent('Central Library');
    expect(screen.getByTestId('art-official-block')).toHaveTextContent('Block 37');
  });

  it('unresolved: no map actions at all', () => {
    const unresolved = manifest.associations.find((a) => a.status === 'unresolved')!;
    render(<ArtworkDetailCard model={model} subjectId={unresolved.subjectId} {...handlers()} />);
    expect(screen.getByTestId('art-association-badge')).toHaveTextContent('Not linked to a map building');
    expect(screen.queryByRole('button', { name: /Directions|Show on map|unconfirmed/ })).toBeNull();
  });

  it('a held label shows neither its text nor its vignette', () => {
    const held = manifest.subjects.find((s) => s.displayHold)!;
    render(<ArtworkDetailCard model={model} subjectId={held.subjectId} {...handlers()} />);
    const card = screen.getByTestId('art-detail-card');
    expect(card.textContent).not.toContain(held.displayLabel!.text);
    expect(within(card).queryByTestId('art-vignette')).toBeNull();
    expect(card).toHaveTextContent(/withheld/);
  });
});
