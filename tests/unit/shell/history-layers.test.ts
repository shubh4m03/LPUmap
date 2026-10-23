import { describe, expect, it } from 'vitest';
import { createHistoryLayers, type HistoryLike } from '../../../src/app/hooks/useHistoryLayers.ts';

/** A session history whose `go()` is asynchronous, like a real browser's. */
function fakeHistory() {
  const entries: unknown[] = [null];
  let index = 0;
  const pendingGo: number[] = [];
  const history: HistoryLike = {
    get state() {
      return entries[index];
    },
    pushState(data) {
      entries.splice(index + 1, entries.length, data);
      index += 1;
    },
    go(delta) {
      pendingGo.push(delta);
    },
  };
  return {
    history,
    entries,
    get index() {
      return index;
    },
    /** Delivers queued traversals; returns how many popstates fired. */
    flush(onPop: () => void) {
      let fired = 0;
      while (pendingGo.length) {
        index = Math.max(0, index + pendingGo.shift()!);
        fired += 1;
        onPop();
      }
      return fired;
    },
    /** A user pressing the browser back button. */
    back(onPop: () => void) {
      index -= 1;
      onPop();
    },
  };
}

describe('createHistoryLayers', () => {
  it('pushes one entry per opened layer', () => {
    const h = fakeHistory();
    let target = 0;
    const layers = createHistoryLayers(
      h.history,
      () => 'http://x/',
      () => target,
    );
    target = 2;
    layers.sync(target);
    expect(h.index).toBe(2);
    expect(h.history.state).toMatchObject({ atlasLayer: 2 });
  });

  it('does not push while a UI-close rewind is pending (close palette + open panel in one tick)', () => {
    const h = fakeHistory();
    let target = 0;
    const layers = createHistoryLayers(
      h.history,
      () => 'http://x/',
      () => target,
    );
    // Palette open.
    target = 1;
    layers.sync(target);
    // Choosing a category: the palette closes (rewind) and a panel opens in the same tick.
    target = 0;
    layers.sync(target);
    target = 1;
    layers.sync(target);
    expect(h.index).toBe(1); // nothing pushed yet: the rewind has not landed
    h.flush(() => expect(layers.onPopState()).toBe(false));
    // After the rewind, the panel's entry is pushed on top of the base entry.
    expect(h.index).toBe(1);
    expect(h.history.state).toMatchObject({ atlasLayer: 1 });

    // Open details on top, then the user presses back twice: both close a layer,
    // and the second lands on the app's base entry (not outside the app).
    target = 2;
    layers.sync(target);
    expect(h.index).toBe(2);
    let closes = 0;
    h.back(() => {
      if (layers.onPopState()) closes += 1;
    });
    h.back(() => {
      if (layers.onPopState()) closes += 1;
    });
    expect(closes).toBe(2);
    expect(h.index).toBe(0);
  });

  it('a user back at depth 0 is not treated as closing a layer', () => {
    const h = fakeHistory();
    const layers = createHistoryLayers(
      h.history,
      () => 'http://x/',
      () => 0,
    );
    h.history.pushState(null, '');
    h.back(() => expect(layers.onPopState()).toBe(false));
  });
});
