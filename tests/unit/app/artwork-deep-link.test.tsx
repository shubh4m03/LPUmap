/**
 * `?place=art:…` deep links (src/app/hooks/useDeepLink.ts): an illustration
 * item opens its details by its stable id; a verified one opens its building;
 * an unknown id is dropped from the URL with a notice.
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useDeepLink } from '../../../src/app/hooks/useDeepLink.ts';
import { useAppStore } from '../../../src/app/store/index.ts';
import { artServices, CANDIDATE_25, VERIFIED_25 } from '../directory/artwork-fixtures.ts';
import { renderWithAtlas, resetAppStore } from './render-helpers.tsx';

function Probe() {
  useDeepLink();
  return null;
}

const open = (search: string) => window.history.replaceState(null, '', `/${search}`);

afterEach(() => {
  cleanup();
  resetAppStore();
  open('');
});

describe('art: deep links', () => {
  it('selects an artwork-only item by its art: id', () => {
    open('?place=art%3Anum-56');
    renderWithAtlas(<Probe />, artServices());
    expect(useAppStore.getState().selectedPlaceId).toBe('art:num-56');
    expect(useAppStore.getState().activePanel).toBe('details');
  });

  it('opens the building of a verified item (one id everywhere)', () => {
    open('?place=art%3Anum-25');
    renderWithAtlas(<Probe />, artServices([VERIFIED_25]));
    expect(useAppStore.getState().selectedPlaceId).toBe(CANDIDATE_25);
    // The address bar now names the building, not the artwork item.
    expect(new URLSearchParams(window.location.search).get('place')).toBe(CANDIDATE_25);
  });

  it('drops an unknown art: id with a notice', async () => {
    open('?place=art%3Anum-999');
    renderWithAtlas(<Probe />, artServices());
    expect(useAppStore.getState().selectedPlaceId).toBeNull();
    expect(new URLSearchParams(window.location.search).has('place')).toBe(false);
    expect(
      await screen.findByText('The linked place is not in the current campus dataset.'),
    ).toBeInTheDocument();
  });
});
