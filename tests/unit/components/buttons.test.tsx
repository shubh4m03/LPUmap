import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Button,
  IconButton,
  SearchInput,
  Switch,
  TextInput,
  ToggleChip,
} from '../../../src/components/ui/index.ts';

afterEach(cleanup);

describe('Button', () => {
  it('uses its text as the accessible name and defaults to type=button', () => {
    render(<Button icon="route">Directions</Button>);
    const btn = screen.getByRole('button', { name: 'Directions' });
    expect(btn).toHaveAttribute('type', 'button');
    // The icon is decorative and does not leak into the name.
    expect(btn.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('blocks activation and exposes busy state while loading, keeping the label', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('fires onClick when enabled and not when disabled', async () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Go</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <Button onClick={onClick} disabled>
        Go
      </Button>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('declares a 44px minimum target on coarse pointers', () => {
    render(<Button>Tap</Button>);
    expect(screen.getByRole('button').className).toMatch(/pointer-coarse:min-h-11/);
  });
});

describe('IconButton', () => {
  it('is named by its label and shows it as a tooltip', () => {
    render(<IconButton icon="locate" label="Show my location" />);
    const btn = screen.getByRole('button', { name: 'Show my location' });
    expect(btn).toHaveAttribute('title', 'Show my location');
    expect(btn.textContent).toBe('');
  });

  it('can suppress the tooltip but keeps the name', () => {
    render(<IconButton icon="close" label="Close" tooltip={false} />);
    const btn = screen.getByRole('button', { name: 'Close' });
    expect(btn).not.toHaveAttribute('title');
  });
});

describe('TextInput / SearchInput', () => {
  it('associates a visible label, hint and error', () => {
    render(
      <TextInput label="Details" hint="Describe the issue" error="Required" value="" onChange={() => {}} />,
    );
    const input = screen.getByLabelText('Details');
    expect(input).toHaveAccessibleDescription('Describe the issue Required');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('supports a hidden label via aria-label', () => {
    render(<TextInput aria-label="Room number" />);
    expect(screen.getByRole('textbox', { name: 'Room number' })).toBeInTheDocument();
  });

  it('shows a clear button only with a value, clears and refocuses the input', async () => {
    const onClear = vi.fn();
    const { rerender } = render(
      <SearchInput aria-label="Search campus" value="" onChange={() => {}} onClear={onClear} />,
    );
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    rerender(<SearchInput aria-label="Search campus" value="lib" onChange={() => {}} onClear={onClear} />);
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('searchbox', { name: 'Search campus' })).toHaveFocus();
  });

  it('clears on Escape when there is text', async () => {
    const onClear = vi.fn();
    render(<SearchInput aria-label="Search campus" value="atm" onChange={() => {}} onClear={onClear} />);
    screen.getByRole('searchbox').focus();
    await userEvent.keyboard('{Escape}');
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe('ToggleChip and Switch', () => {
  it('ToggleChip exposes aria-pressed and toggles', async () => {
    const onPressedChange = vi.fn();
    render(
      <ToggleChip pressed={false} onPressedChange={onPressedChange} icon="utensils">
        Food
      </ToggleChip>,
    );
    const chip = screen.getByRole('button', { name: 'Food' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(chip);
    expect(onPressedChange).toHaveBeenCalledWith(true);
  });

  it('Switch is a labelled role=switch toggled by its visible label', async () => {
    const onCheckedChange = vi.fn();
    render(
      <Switch
        checked
        label="Save search history"
        description="Stored on this device only"
        onCheckedChange={onCheckedChange}
      />,
    );
    const sw = screen.getByRole('switch', { name: 'Save search history' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(sw).toHaveAccessibleDescription('Stored on this device only');
    await userEvent.click(screen.getByText('Save search history'));
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });
});
