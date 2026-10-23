import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { THEME_STORAGE_KEY, defaultThemeStore } from '../../../src/accessibility/index.ts';
import { SettingsPanel } from '../../../src/components/settings/SettingsPanel.tsx';
import { useFavorites, useRecents } from '../../../src/favorites/index.ts';
import { useCorrectionDraft } from '../../../src/feedback/index.ts';
import { PRIVACY_FACTS, usePrivacySettings } from '../../../src/privacy/index.ts';
import { useAppStore } from '../../../src/app/store/index.ts';
import { renderWithAtlas } from '../app/render-helpers.tsx';
import { resetPlatformState } from './helpers.ts';

const appKeys = () =>
  [...Array(localStorage.length).keys()]
    .map((i) => localStorage.key(i))
    .filter((k): k is string => k !== null && k.startsWith('lpu-atlas:'));

describe('SettingsPanel', () => {
  beforeEach(resetPlatformState);
  afterEach(cleanup);

  it('changes the theme through the segmented control and persists it', async () => {
    const user = userEvent.setup();
    renderWithAtlas(<SettingsPanel />);
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    expect(within(group).getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(group).getByRole('radio', { name: 'Dark' }));
    expect(defaultThemeStore.getPreference()).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(screen.getByText('Always dark.')).toBeInTheDocument();
  });

  it('turning search history off deletes recents and says so', async () => {
    const user = userEvent.setup();
    useRecents.getState().push('osm:node/1');
    renderWithAtlas(<SettingsPanel />);
    const toggle = screen.getByRole('switch', { name: 'Save search history' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.click(toggle);
    expect(usePrivacySettings.getState().saveHistory).toBe(false);
    expect(useRecents.getState().ids).toEqual([]);
    expect(await screen.findByText(/Your recent places were deleted from this device/)).toBeInTheDocument();
  });

  it('clear all local data asks first; cancel keeps everything', async () => {
    const user = userEvent.setup();
    useFavorites.getState().toggle('osm:node/1');
    renderWithAtlas(<SettingsPanel />);
    await user.click(screen.getByRole('button', { name: 'Clear all local data' }));
    const dialog = screen.getByRole('dialog', { name: 'Clear all local data?' });
    expect(within(dialog).getByText('1 saved place')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(useFavorites.getState().ids).toEqual(['osm:node/1']);
  });

  it('confirming clears favourites, recents, theme and drafts, and confirms with a toast', async () => {
    const user = userEvent.setup();
    useFavorites.getState().toggle('osm:node/1');
    useRecents.getState().push('osm:node/4');
    useCorrectionDraft.getState().update({ details: 'Some unsent text here' });
    defaultThemeStore.setPreference('dark');
    renderWithAtlas(<SettingsPanel />);
    await user.click(screen.getByRole('button', { name: 'Clear all local data' }));
    await user.click(screen.getByRole('button', { name: 'Clear data' }));
    expect(useFavorites.getState().ids).toEqual([]);
    expect(useRecents.getState().ids).toEqual([]);
    expect(useCorrectionDraft.getState().draft.details).toBe('');
    expect(defaultThemeStore.getPreference()).toBe('system');
    expect(appKeys()).toEqual([]);
    expect(sessionStorage.length).toBe(0);
    expect(await screen.findByText(/Cleared: saved places, recent places/)).toBeInTheDocument();
  });

  it('opening the confirmation from a full mobile sheet drops it to half and restores it', async () => {
    const user = userEvent.setup();
    useAppStore.getState().setSheetSnap('full');
    renderWithAtlas(<SettingsPanel />);
    await user.click(screen.getByRole('button', { name: 'Clear all local data' }));
    expect(useAppStore.getState().sheetSnap).toBe('half');
    await user.keyboard('{Escape}');
    expect(useAppStore.getState().sheetSnap).toBe('full');
  });

  it('renders every privacy fact and the app and dataset versions', () => {
    renderWithAtlas(<SettingsPanel />);
    for (const fact of PRIVACY_FACTS) {
      expect(screen.getByText(fact.title)).toBeInTheDocument();
      expect(screen.getByText(fact.detail)).toBeInTheDocument();
    }
    const versions = screen.getByLabelText('Version information');
    expect(versions).toHaveTextContent(/App version\s*\d+\.\d+\.\d+/);
    expect(versions).toHaveTextContent('Dataset versionsynthetic-001');
    expect(versions).toHaveTextContent('Data retrieved1 Oct 2026');
  });

  it('describes the motion behaviour', () => {
    renderWithAtlas(<SettingsPanel />);
    expect(screen.getByText(/reduced-motion setting/)).toBeInTheDocument();
  });
});
