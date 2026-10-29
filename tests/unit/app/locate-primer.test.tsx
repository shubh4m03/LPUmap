import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../../src/app/store/index.ts';
import { LocateButton } from '../../../src/components/map-controls/LocateButton.tsx';
import {
  LOCATION_PRIMER_TEXT,
  LOCATION_PRIMER_TITLE,
  resetLocationPrimer,
} from '../../../src/components/map-controls/location-primer.ts';
import { renderWithAtlas, resetAppStore } from './render-helpers.tsx';

// G-15: the main Locate button explains why the atlas needs the location BEFORE the browser's
// permission prompt (startLocation is what triggers that prompt).
type PermissionAnswer = PermissionState | 'no-api' | 'throws';

function stubBrowser(answer: PermissionAnswer) {
  Object.defineProperty(navigator, 'geolocation', { value: {}, configurable: true });
  const permissions =
    answer === 'no-api'
      ? undefined
      : {
          query: vi.fn(() =>
            answer === 'throws' ? Promise.reject(new TypeError('x')) : Promise.resolve({ state: answer }),
          ),
        };
  Object.defineProperty(navigator, 'permissions', { value: permissions, configurable: true });
}

function setup(answer: PermissionAnswer) {
  stubBrowser(answer);
  const startLocation = vi.fn();
  useAppStore.setState({ startLocation });
  renderWithAtlas(<LocateButton />);
  return { startLocation, button: screen.getByRole('button', { name: 'Show my location' }) };
}

describe('LocateButton location primer', () => {
  beforeEach(() => {
    resetAppStore();
    resetLocationPrimer();
  });
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(navigator, 'geolocation');
    Reflect.deleteProperty(navigator, 'permissions');
  });

  for (const answer of ['prompt', 'no-api', 'throws'] as const) {
    it(`permission "${answer}": explains the purpose first; the prompt starts only on Continue`, async () => {
      const { startLocation, button } = setup(answer);
      await userEvent.click(button);
      const dialog = await screen.findByRole('dialog', { name: LOCATION_PRIMER_TITLE });
      expect(dialog).toHaveAccessibleDescription(LOCATION_PRIMER_TEXT);
      expect(LOCATION_PRIMER_TEXT).toMatch(/only on this device/);
      expect(LOCATION_PRIMER_TEXT).toMatch(/never stored or sent/);
      expect(startLocation).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
      expect(startLocation).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      // Explained once per session: the next tap goes straight to the browser.
      await userEvent.click(button);
      await waitFor(() => expect(startLocation).toHaveBeenCalledTimes(2));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  }

  it('"Not now" closes the explanation without asking the browser', async () => {
    const { startLocation, button } = setup('prompt');
    await userEvent.click(button);
    await userEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(startLocation).not.toHaveBeenCalled();
  });

  for (const answer of ['granted', 'denied'] as const) {
    it(`permission already "${answer}": no explanation, location starts at once`, async () => {
      const { startLocation, button } = setup(answer);
      await userEvent.click(button);
      await waitFor(() => expect(startLocation).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  }
});
