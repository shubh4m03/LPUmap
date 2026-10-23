import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../../src/app/store/index.ts';
import { FavoritesPanel } from '../../../src/components/favorites/FavoritesPanel.tsx';
import { useFavorites, useRecents } from '../../../src/favorites/index.ts';
import { usePrivacySettings } from '../../../src/privacy/index.ts';
import { renderWithAtlas } from '../app/render-helpers.tsx';
import { resetPlatformState } from './helpers.ts';

const favorite = (...ids: string[]) => {
  for (const id of [...ids].reverse()) useFavorites.getState().toggle(id);
};

describe('FavoritesPanel', () => {
  beforeEach(resetPlatformState);
  afterEach(cleanup);

  it('shows an honest empty state', () => {
    renderWithAtlas(<FavoritesPanel />);
    expect(screen.getByText('No saved places yet')).toBeInTheDocument();
    expect(screen.queryByText(/no longer in the dataset/)).not.toBeInTheDocument();
  });

  it('reports saved ids missing from the dataset and removes them on request', async () => {
    const user = userEvent.setup();
    favorite('osm:node/1', 'osm:node/gone-1', 'osm:node/gone-2');
    renderWithAtlas(<FavoritesPanel />);
    expect(screen.getByText(/2 saved places are no longer in the dataset/)).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Saved places' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Remove them' }));
    expect(useFavorites.getState().ids).toEqual(['osm:node/1']);
    expect(screen.queryByText(/no longer in the dataset/)).not.toBeInTheDocument();
    expect(await screen.findByText(/Removed 2 saved places that no longer exist/)).toBeInTheDocument();
  });

  it('uses the singular for one stale id', () => {
    favorite('osm:node/gone');
    renderWithAtlas(<FavoritesPanel />);
    expect(screen.getByText(/1 saved place is no longer in the dataset/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove it' })).toBeInTheDocument();
  });

  it('selecting a row opens the place; directions only for routable places', async () => {
    const user = userEvent.setup();
    favorite('osm:node/1', 'cur:synthetic-library');
    renderWithAtlas(<FavoritesPanel />);
    expect(screen.getByText('Library & study · No verified map position')).toBeInTheDocument();
    expect(screen.getByText(/Off campus \(nearby\)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Directions to Synthetic Library' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Synthetic Food Point/ }));
    expect(useAppStore.getState().selectedPlaceId).toBe('osm:node/1');

    await user.click(screen.getByRole('button', { name: 'Directions to Synthetic Food Point' }));
    const s = useAppStore.getState();
    expect(s.destination).toMatchObject({ kind: 'place', placeId: 'osm:node/1' });
    expect(s.activePanel).toBe('directions');
  });

  it('removes a single saved place', async () => {
    const user = userEvent.setup();
    favorite('osm:node/1');
    renderWithAtlas(<FavoritesPanel />);
    await user.click(screen.getByRole('button', { name: 'Remove Synthetic Food Point from saved places' }));
    expect(useFavorites.getState().ids).toEqual([]);
    expect(screen.getByText('No saved places yet')).toBeInTheDocument();
  });

  it('lists recents while history is on, and can clear them', async () => {
    const user = userEvent.setup();
    useRecents.getState().push('osm:node/4');
    useRecents.getState().push('osm:node/missing');
    renderWithAtlas(<FavoritesPanel />);
    const recents = screen.getByRole('list', { name: 'Recent places' });
    expect(within(recents).getAllByRole('listitem')).toHaveLength(1);
    expect(within(recents).getByText('Stale Hours Cafe')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear recent places' }));
    expect(useRecents.getState().ids).toEqual([]);
  });

  it('says history is off instead of listing recents', () => {
    usePrivacySettings.getState().setSaveHistory(false);
    renderWithAtlas(<FavoritesPanel />);
    expect(screen.queryByRole('list', { name: 'Recent places' })).not.toBeInTheDocument();
    expect(screen.getByText(/Search history is off/)).toBeInTheDocument();
  });
});
