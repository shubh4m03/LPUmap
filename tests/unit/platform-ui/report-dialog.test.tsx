import { act, cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../../src/app/store/index.ts';
import { ReportDialog } from '../../../src/components/report/ReportDialog.tsx';
import { useCorrectionDraft } from '../../../src/feedback/index.ts';
import { renderWithAtlas } from '../app/render-helpers.tsx';
import { resetPlatformState } from './helpers.ts';

const TRACKER = 'https://github.com/example/atlas/issues/new';

function openFor(target: Parameters<ReturnType<typeof useAppStore.getState>['openReport']>[0]) {
  act(() => useAppStore.getState().openReport(target));
}

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText('What needs correcting?'), 'wrong-hours');
  await user.type(screen.getByLabelText('Details'), 'Opens at 9 am on weekdays, not 8 am.');
}

describe('ReportDialog', () => {
  beforeEach(() => {
    resetPlatformState();
    vi.stubEnv('VITE_CORRECTIONS_URL', '');
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it('is closed until a report target is set, and prefills the place', () => {
    renderWithAtlas(<ReportDialog />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    openFor({ placeId: 'osm:node/1', placeName: 'Synthetic Food Point' });
    const dialog = screen.getByRole('dialog', { name: 'Suggest a correction' });
    expect(dialog).toHaveAccessibleDescription(/Nothing is sent automatically/);
    expect(within(dialog).getByText('Synthetic Food Point')).toBeInTheDocument();
    expect(within(dialog).getByText('Record id: osm:node/1')).toBeInTheDocument();
    // Kind is unset, so focus starts there rather than on the close button.
    expect(screen.getByLabelText('What needs correcting?')).toHaveFocus();
  });

  it('a general missing-place report has an editable, prefilled place field and focuses details', () => {
    renderWithAtlas(<ReportDialog />);
    openFor({ kind: 'missing-facility', placeName: 'xyzzy' });
    expect(screen.getByLabelText('Place (optional)')).toHaveValue('xyzzy');
    expect(screen.getByLabelText('What needs correcting?')).toHaveValue('missing-facility');
    expect(screen.getByLabelText('Details')).toHaveFocus();
  });

  it('shows inline, announced validation errors and focuses the first invalid field', async () => {
    const user = userEvent.setup();
    renderWithAtlas(<ReportDialog />);
    openFor({});
    await user.type(screen.getByLabelText('Details'), 'short');
    await user.type(screen.getByLabelText('Source link (optional)'), 'not a url');
    await user.click(screen.getByRole('button', { name: 'Review report' }));

    const kind = screen.getByLabelText('What needs correcting?');
    expect(kind).toHaveAttribute('aria-invalid', 'true');
    expect(kind).toHaveAccessibleDescription('Choose what kind of correction this is.');
    expect(kind).toHaveFocus();
    expect(screen.getByLabelText('Details')).toHaveAccessibleDescription(/at least 10 characters/);
    expect(screen.getByLabelText('Source link (optional)')).toHaveAccessibleDescription(
      /full http:\/\/ or https:\/\/ address/,
    );
    expect(await screen.findByText(/The report has 3 problems/)).toBeInTheDocument();
    expect(screen.queryByText('Report text')).not.toBeInTheDocument();

    await user.selectOptions(kind, 'other');
    expect(kind).not.toHaveAttribute('aria-invalid');
  });

  it('shows a live character counter', async () => {
    const user = userEvent.setup();
    renderWithAtlas(<ReportDialog />);
    openFor({});
    await user.type(screen.getByLabelText('Details'), 'abc');
    expect(screen.getByText(/^3\/2000/)).toBeInTheDocument();
  });

  it('keeps an unsent draft in session storage and restores it for the same place', async () => {
    const user = userEvent.setup();
    renderWithAtlas(<ReportDialog />);
    openFor({ placeId: 'osm:node/1', placeName: 'Synthetic Food Point' });
    await fillValid(user);
    expect(useCorrectionDraft.getState().draft).toMatchObject({
      kind: 'wrong-hours',
      placeId: 'osm:node/1',
      details: 'Opens at 9 am on weekdays, not 8 am.',
    });
    expect(sessionStorage.getItem('lpu-atlas:v1:correction-draft')).toContain('Opens at 9 am');
    expect(localStorage.getItem('lpu-atlas:v1:correction-draft')).toBeNull();

    act(() => useAppStore.getState().closeReport());
    openFor({ placeId: 'osm:node/1', placeName: 'Synthetic Food Point' });
    expect(screen.getByText('Restored your unsent draft from this session.')).toBeInTheDocument();
    expect(screen.getByLabelText('Details')).toHaveValue('Opens at 9 am on weekdays, not 8 am.');

    await user.click(screen.getByRole('button', { name: 'Start over' }));
    expect(screen.getByLabelText('Details')).toHaveValue('');
    expect(useCorrectionDraft.getState().draft.details).toBe('');
  });

  it('does not restore a draft written about a different place', async () => {
    const user = userEvent.setup();
    renderWithAtlas(<ReportDialog />);
    openFor({ placeId: 'osm:node/1', placeName: 'Synthetic Food Point' });
    await fillValid(user);
    act(() => useAppStore.getState().closeReport());
    openFor({ placeId: 'osm:node/4', placeName: 'Stale Hours Cafe' });
    expect(screen.queryByText(/Restored your unsent draft/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Details')).toHaveValue('');
  });

  it('review shows the exact text, copy and download, and no tracker link when none is configured', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const createObjectURL = vi.fn(() => 'blob:report');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderWithAtlas(<ReportDialog />);
    openFor({ placeId: 'osm:node/1', placeName: 'Synthetic Food Point' });
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Review report' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Nothing has been sent.')).toBeInTheDocument();
    const text = within(dialog).getByLabelText('Report text');
    expect(text).toHaveTextContent('Type: Wrong opening hours');
    expect(text).toHaveTextContent('Place: Synthetic Food Point');
    expect(text).toHaveTextContent('Dataset version: synthetic-001');
    expect(within(dialog).queryByRole('link', { name: /Open prefilled report/ })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/No public report tracker is configured/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Copy report' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Opens at 9 am on weekdays'));
    expect(await screen.findByText('Report copied to the clipboard.')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Download .txt' }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);

    // No location or device details ever reach the report.
    const body = String(writeText.mock.calls[0]?.[0]);
    expect(body).not.toMatch(/latitude|longitude|user.?agent|Mozilla|75\.7/i);
  });

  it('offers the prefilled tracker link when VITE_CORRECTIONS_URL is an https URL', async () => {
    vi.stubEnv('VITE_CORRECTIONS_URL', TRACKER);
    const user = userEvent.setup();
    renderWithAtlas(<ReportDialog />);
    openFor({ placeId: 'osm:node/1', placeName: 'Synthetic Food Point' });
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Review report' }));
    const link = screen.getByRole('link', { name: /Open prefilled report/ });
    expect(link.getAttribute('href')).toMatch(/^https:\/\/github\.com\/example\/atlas\/issues\/new\?title=/);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText(/anything posted there is public/)).toBeInTheDocument();
  });

  it('never claims the report was submitted or sent', async () => {
    vi.stubEnv('VITE_CORRECTIONS_URL', TRACKER);
    const user = userEvent.setup();
    renderWithAtlas(<ReportDialog />);
    openFor({ placeId: 'osm:node/1', placeName: 'Synthetic Food Point' });
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Review report' }));
    const content = document.body.textContent ?? '';
    expect(content).not.toMatch(/submitted|thank you|was sent|report sent|received/i);
  });

  it('discarding clears the draft and closes the dialog', async () => {
    const user = userEvent.setup();
    renderWithAtlas(<ReportDialog />);
    openFor({ placeId: 'osm:node/1', placeName: 'Synthetic Food Point' });
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Review report' }));
    await user.click(screen.getByRole('button', { name: 'Discard draft and close' }));
    expect(useAppStore.getState().reportTarget).toBeNull();
    expect(useCorrectionDraft.getState().draft.details).toBe('');
    expect(sessionStorage.getItem('lpu-atlas:v1:correction-draft')).toBeNull();
  });
});
