import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceWorkerUpdate } from '../../../src/offline/index.ts';

const state = vi.hoisted(() => ({
  online: true,
  sw: {
    supported: true,
    updateAvailable: false,
    offlineReady: false,
    error: null as string | null,
  },
  applyUpdate: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock('../../../src/offline/index.ts', () => ({
  useOnlineStatus: () => state.online,
  useServiceWorkerUpdate: (): ServiceWorkerUpdate => ({
    ...state.sw,
    applyUpdate: state.applyUpdate,
    dismiss: state.dismiss,
  }),
}));

const { OfflineStatus } = await import('../../../src/components/offline/OfflineStatus.tsx');
const { ToastProvider } = await import('../../../src/components/ui/index.ts');

function renderStatus() {
  const view = render(
    <ToastProvider>
      <OfflineStatus />
    </ToastProvider>,
  );
  return {
    ...view,
    update: (patch: Partial<typeof state.sw> & { online?: boolean }) => {
      const { online, ...sw } = patch;
      if (online !== undefined) state.online = online;
      Object.assign(state.sw, sw);
      act(() =>
        view.rerender(
          <ToastProvider>
            <OfflineStatus />
          </ToastProvider>,
        ),
      );
    },
  };
}

describe('OfflineStatus', () => {
  beforeEach(() => {
    state.online = true;
    state.sw = { supported: true, updateAvailable: false, offlineReady: false, error: null };
    state.applyUpdate.mockReset();
    state.dismiss.mockReset();
  });
  afterEach(cleanup);

  it('renders nothing while online with no update', () => {
    renderStatus();
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the offline banner, then a back-online toast', () => {
    state.online = false;
    const view = renderStatus();
    expect(
      screen.getByText(
        'You are offline — showing the saved map and data; corrections links and data refresh need a connection.',
      ),
    ).toBeInTheDocument();
    view.update({ online: true });
    expect(screen.queryByText(/You are offline/)).not.toBeInTheDocument();
    expect(screen.getByText('Back online.')).toBeInTheDocument();
  });

  it('keeps the banner below the mobile sheet and dialogs (panel layer)', () => {
    state.online = false;
    renderStatus();
    const layer = screen.getByText(/You are offline/).closest('.fixed');
    expect(layer?.className).toContain('z-(--ds-z-panels)');
    expect(layer?.className).not.toMatch(/z-\(--ds-z-(sheet|dialog|toast)\)/);
  });

  it('does not announce "back online" when the app simply starts online', () => {
    renderStatus();
    expect(screen.queryByText('Back online.')).not.toBeInTheDocument();
  });

  it('asks before updating: Update now applies, Later dismisses', async () => {
    const user = userEvent.setup();
    state.sw.updateAvailable = true;
    renderStatus();
    expect(screen.getByText(/A new version of the app and campus data is ready/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Update now' }));
    expect(state.applyUpdate).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Later' }));
    expect(state.dismiss).toHaveBeenCalledTimes(1);
  });

  it('announces offline readiness once', () => {
    const view = renderStatus();
    view.update({ offlineReady: true });
    view.update({ offlineReady: true });
    expect(screen.getAllByText(/Ready to work offline/)).toHaveLength(1);
  });

  it('surfaces a registration error', () => {
    const view = renderStatus();
    view.update({ error: 'Offline support could not be enabled: SecurityError.' });
    expect(screen.getByText('Offline support could not be enabled: SecurityError.')).toBeInTheDocument();
  });
});
