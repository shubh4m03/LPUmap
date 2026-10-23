import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, Dialog } from '../../../src/components/ui/index.ts';

function Harness({
  onCloseSpy = () => {},
  withInitial = false,
}: {
  onCloseSpy?: () => void;
  withInitial?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const close = () => {
    onCloseSpy();
    setOpen(false);
  };
  return (
    <>
      <button type="button">Before</button>
      <Button onClick={() => setOpen(true)}>Report a correction</Button>
      <Dialog
        open={open}
        onClose={close}
        title="Report a correction"
        description="Tell us what is wrong."
        {...(withInitial ? { initialFocus: inputRef } : {})}
        footer={<Button onClick={close}>Cancel</Button>}
      >
        <label>
          Details
          <input ref={inputRef} />
        </label>
      </Dialog>
    </>
  );
}

afterEach(cleanup);

describe('Dialog', () => {
  it('renders nothing when closed', () => {
    render(<Dialog open={false} onClose={() => {}} title="Hidden" />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is modal, labelled and described, and moves focus inside', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Report a correction' }));
    const dialog = screen.getByRole('dialog', { name: 'Report a correction' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Tell us what is wrong.');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    // Rendered through a portal directly under <body>.
    expect(dialog.closest('body > div')).not.toBeNull();
  });

  it('honours initialFocus', async () => {
    render(<Harness withInitial />);
    await userEvent.click(screen.getByRole('button', { name: 'Report a correction' }));
    expect(screen.getByLabelText('Details')).toHaveFocus();
  });

  it('traps Tab and Shift+Tab inside the dialog', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Report a correction' }));
    const dialog = screen.getByRole('dialog');
    const close = screen.getByRole('button', { name: 'Close' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(close).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByLabelText('Details')).toHaveFocus();
    await userEvent.tab();
    expect(cancel).toHaveFocus();
    await userEvent.tab();
    expect(close).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(cancel).toHaveFocus();
    for (let i = 0; i < 7; i++) {
      await userEvent.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it('closes on Escape and restores focus to the trigger', async () => {
    const spy = vi.fn();
    render(<Harness onCloseSpy={spy} />);
    const trigger = screen.getByRole('button', { name: 'Report a correction' });
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('closes on scrim click but not on clicks inside the panel', async () => {
    const spy = vi.fn();
    render(<Harness onCloseSpy={spy} />);
    await userEvent.click(screen.getByRole('button', { name: 'Report a correction' }));
    await userEvent.click(screen.getByLabelText('Details'));
    expect(spy).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('dialog-scrim'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('locks body scroll while open and restores it on close', async () => {
    document.body.style.overflow = 'scroll';
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Report a correction' }));
    expect(document.body.style.overflow).toBe('hidden');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(document.body.style.overflow).toBe('scroll');
    document.body.style.overflow = '';
  });
});
