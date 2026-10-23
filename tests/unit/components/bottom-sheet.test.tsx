import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BottomSheet,
  Button,
  closestSnap,
  nextSnap,
  SHEET_PEEK_PX,
  snapHeightsPx,
  type SheetSnap,
} from '../../../src/components/ui/index.ts';

afterEach(cleanup);

function Harness({ initial = 'peek' as SheetSnap, onClose = () => {} }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open details</Button>
      <BottomSheet
        open={open}
        defaultSnap={initial}
        title="Central Library"
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      >
        <button type="button">Directions</button>
      </BottomSheet>
    </>
  );
}

const handle = () => screen.getByRole('button', { name: /^Resize Central Library/ });
const sheetEl = () => document.querySelector<HTMLElement>('[data-snap]')!;

describe('BottomSheet', () => {
  it('starts non-modal (region) at peek with content inert and a visible close button', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open details' }));
    expect(screen.getByRole('region', { name: 'Central Library' })).toHaveAttribute('data-snap', 'peek');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('sheet-content')).toHaveAttribute('inert');
    expect(screen.getByRole('button', { name: 'Close' })).toBeVisible();
    // No focus trap at peek: Shift+Tab from the handle leaves the sheet.
    handle().focus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Open details' })).toHaveFocus();
  });

  it('cycles snap points with Enter and Space on the handle, announcing the state in its name', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open details' }));
    handle().focus();
    expect(handle()).toHaveAccessibleName('Resize Central Library: collapsed');
    expect(handle()).toHaveAccessibleDescription(/Enter or Space/);
    await userEvent.keyboard('{Enter}');
    expect(sheetEl()).toHaveAttribute('data-snap', 'half');
    expect(screen.getByTestId('sheet-content')).not.toHaveAttribute('inert');
    await userEvent.keyboard(' ');
    expect(sheetEl()).toHaveAttribute('data-snap', 'full');
    expect(screen.getByRole('dialog', { name: 'Central Library' })).toHaveAttribute('aria-modal', 'true');
    expect(handle()).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(sheetEl()).toHaveAttribute('data-snap', 'peek');
    expect(handle()).toHaveFocus();
  });

  it('traps focus only when full', async () => {
    render(<Harness initial="full" />);
    await userEvent.click(screen.getByRole('button', { name: 'Open details' }));
    const sheet = screen.getByRole('dialog', { name: 'Central Library' });
    for (let i = 0; i < 6; i++) {
      await userEvent.tab();
      expect(sheet).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it('closes with Escape and returns focus to the opener', async () => {
    const onClose = vi.fn();
    render(<Harness initial="half" onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Open details' });
    await userEvent.click(opener);
    screen.getByRole('button', { name: 'Directions' }).focus();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sheetEl()).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('closes with the close button', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open details' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('snaps to the nearest point after a pointer drag and suppresses the trailing click', async () => {
    window.innerHeight = 800;
    render(<Harness initial="peek" />);
    await userEvent.click(screen.getByRole('button', { name: 'Open details' }));
    vi.spyOn(sheetEl(), 'getBoundingClientRect').mockReturnValue({ height: 128 } as DOMRect);
    fireEvent.pointerDown(handle(), { button: 0, clientY: 700, pointerId: 1 });
    fireEvent.pointerMove(handle(), { clientY: 500, pointerId: 1 });
    expect(sheetEl().style.height).toBe('328px');
    fireEvent.pointerUp(handle(), { clientY: 430, pointerId: 1 });
    fireEvent.click(handle());
    // 128 + 270 = 398 → nearest is half (400), and the click did not cycle it further.
    expect(sheetEl()).toHaveAttribute('data-snap', 'half');
  });

  it('dismisses when dragged well below the peek height', async () => {
    const onClose = vi.fn();
    window.innerHeight = 800;
    render(<Harness initial="peek" onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open details' }));
    vi.spyOn(sheetEl(), 'getBoundingClientRect').mockReturnValue({ height: 128 } as DOMRect);
    fireEvent.pointerDown(handle(), { button: 0, clientY: 700, pointerId: 1 });
    fireEvent.pointerMove(handle(), { clientY: 760, pointerId: 1 });
    fireEvent.pointerUp(handle(), { clientY: 790, pointerId: 1 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('springs back to the current snap when the drag is cancelled', async () => {
    const onClose = vi.fn();
    window.innerHeight = 800;
    render(<Harness initial="half" onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open details' }));
    vi.spyOn(sheetEl(), 'getBoundingClientRect').mockReturnValue({ height: 400 } as DOMRect);
    fireEvent.pointerDown(handle(), { button: 0, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(handle(), { clientY: 600, pointerId: 1 });
    expect(sheetEl().style.height).toBe('200px');
    // Browsers commonly report 0,0 on pointercancel; that must not be read as a drag to the top.
    fireEvent.pointerCancel(handle(), { clientY: 0, pointerId: 1 });
    expect(onClose).not.toHaveBeenCalled();
    expect(sheetEl()).toHaveAttribute('data-snap', 'half');
    expect(sheetEl().style.height).toBe('50dvh');
    // The next tap still cycles normally (no stale click suppression).
    fireEvent.click(handle());
    expect(sheetEl()).toHaveAttribute('data-snap', 'full');
  });

  it('supports controlled snap', async () => {
    const onSnapChange = vi.fn();
    render(
      <BottomSheet open onClose={() => {}} title="Route" snap="half" onSnapChange={onSnapChange}>
        x
      </BottomSheet>,
    );
    await userEvent.click(screen.getByRole('button', { name: /^Resize Route/ }));
    expect(onSnapChange).toHaveBeenCalledWith('full');
    // Parent did not change the prop, so the sheet stays where it is told.
    expect(sheetEl()).toHaveAttribute('data-snap', 'half');
  });
});

describe('snap geometry', () => {
  it('cycles peek → half → full → peek', () => {
    expect(nextSnap('peek')).toBe('half');
    expect(nextSnap('half')).toBe('full');
    expect(nextSnap('full')).toBe('peek');
  });

  it('keeps heights ordered even on tiny viewports', () => {
    for (const vh of [100, 200, 568, 1200]) {
      const h = snapHeightsPx(vh);
      expect(h.peek).toBeLessThanOrEqual(h.half);
      expect(h.half).toBeLessThanOrEqual(h.full);
      expect(h.peek).toBe(SHEET_PEEK_PX);
    }
  });

  it('chooses the closest snap or closes below 60% of peek', () => {
    expect(closestSnap(130, 800)).toBe('peek');
    expect(closestSnap(390, 800)).toBe('half');
    expect(closestSnap(700, 800)).toBe('full');
    expect(closestSnap(SHEET_PEEK_PX * 0.6 - 1, 800)).toBe('close');
    expect(closestSnap(SHEET_PEEK_PX * 0.6, 800)).toBe('peek');
  });
});
