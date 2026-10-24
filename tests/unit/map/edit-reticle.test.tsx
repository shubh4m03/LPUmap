/** The mobile centre pin sits at the centre of the PADDED viewport (where map.getCenter() is). */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditReticle } from '../../../src/map/editing/EditReticle.tsx';

afterEach(cleanup);

function fakeMap(padding: { top: number; bottom: number; left: number; right: number }) {
  const listeners = new Map<string, Set<() => void>>();
  return {
    padding,
    getPadding() {
      return this.padding;
    },
    on(type: string, fn: () => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
      return this;
    },
    off(type: string, fn: () => void) {
      listeners.get(type)?.delete(fn);
      return this;
    },
    fire(type: string) {
      for (const fn of listeners.get(type) ?? []) fn();
    },
    count: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
  };
}

describe('EditReticle', () => {
  it('follows the map padding (e.g. a bottom sheet) and unsubscribes on unmount', () => {
    const map = fakeMap({ top: 72, bottom: 400, left: 16, right: 60 });
    const view = render(<EditReticle map={map as never} />);
    const pin = screen.getByTestId('edit-reticle');
    expect(pin.style.top).toBe('calc(72px + 0.5 * (100% - 472px))');
    expect(pin.style.left).toBe('calc(16px + 0.5 * (100% - 76px))');
    map.padding = { top: 72, bottom: 100, left: 16, right: 60 };
    act(() => map.fire('move'));
    expect(pin.style.top).toBe('calc(72px + 0.5 * (100% - 172px))');
    view.unmount();
    expect(map.count()).toBe(0);
  });

  it('without a map it is drawn at the container centre', () => {
    render(<EditReticle map={null} />);
    expect(screen.getByTestId('edit-reticle').style.top).toBe('calc(0px + 0.5 * (100% - 0px))');
  });
});
