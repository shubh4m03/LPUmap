import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EmptyState,
  ErrorState,
  ResultRow,
  SegmentedControl,
  Skeleton,
  Spinner,
  VerificationBadge,
  type SegmentOption,
} from '../../../src/components/ui/index.ts';

afterEach(cleanup);

type Mode = 'walk' | 'cycle' | 'step-free';
const MODES: SegmentOption<Mode>[] = [
  { value: 'walk', label: 'Walk', icon: 'walk' },
  { value: 'cycle', label: 'Cycle', icon: 'bike' },
  { value: 'step-free', label: 'Step-free', icon: 'wheelchair' },
];

function Modes({ options = MODES, onChange = (_: Mode) => {} }) {
  const [v, setV] = useState<Mode>('walk');
  return (
    <SegmentedControl
      label="Travel mode"
      options={options}
      value={v}
      onChange={(next) => {
        onChange(next);
        setV(next);
      }}
    />
  );
}

describe('SegmentedControl', () => {
  it('is a labelled radiogroup with a single tab stop on the checked radio', () => {
    render(<Modes />);
    expect(screen.getByRole('radiogroup', { name: 'Travel mode' })).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    expect(screen.getByRole('radio', { name: 'Walk' })).toHaveAttribute('aria-checked', 'true');
  });

  it('moves and selects with arrow keys, wrapping, plus Home/End', async () => {
    const onChange = vi.fn();
    render(<Modes onChange={onChange} />);
    screen.getByRole('radio', { name: 'Walk' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Cycle' })).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'Cycle' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'Walk' })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Step-free' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('radio', { name: 'Walk' })).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('radio', { name: 'Step-free' })).toHaveFocus();
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([
      'cycle',
      'step-free',
      'walk',
      'step-free',
      'walk',
      'step-free',
    ]);
  });

  it('skips disabled options', async () => {
    const opts = MODES.map((o) => (o.value === 'cycle' ? { ...o, disabled: true } : o));
    render(<Modes options={opts} />);
    screen.getByRole('radio', { name: 'Walk' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Step-free' })).toHaveFocus();
  });

  it('keeps accessible names when icon-only', () => {
    render(
      <SegmentedControl
        label="View"
        iconOnly
        options={[
          { value: '2d', label: '2D map', icon: 'map-2d' },
          { value: '3d', label: '3D buildings', icon: 'cube' },
        ]}
        value="2d"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('radio', { name: '3D buildings' })).toBeInTheDocument();
  });
});

describe('ResultRow', () => {
  it('as option exposes role=option and aria-selected, and renders highlight segments', () => {
    const { rerender } = render(
      <div role="listbox" aria-label="Results">
        <ResultRow
          as="option"
          id="r1"
          title="Lovely Institute of Pharmacy"
          segments={[
            { text: 'Lovely ', match: false },
            { text: 'Inst', match: true },
            { text: 'itute of Pharmacy', match: false },
          ]}
          subtitle="Academic building"
          meta="320 m"
          icon="school"
          active={false}
        />
      </div>,
    );
    const opt = screen.getByRole('option', { name: /Lovely Institute of Pharmacy/ });
    expect(opt).toHaveAttribute('aria-selected', 'false');
    expect(opt.querySelector('mark')?.textContent).toBe('Inst');
    rerender(
      <div role="listbox" aria-label="Results">
        <ResultRow as="option" id="r1" title="Lovely Institute of Pharmacy" active />
      </div>,
    );
    expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true');
  });

  it('ignores segments that do not reproduce the title instead of showing wrong text', () => {
    render(<ResultRow title="School of Design" segments={[{ text: 'Something else', match: true }]} />);
    expect(screen.getByRole('button', { name: 'School of Design' })).toBeInTheDocument();
    expect(document.querySelector('mark')).toBeNull();
  });

  it('keys custom-rendered segments itself (no React key warning for unkeyed renderers)', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ResultRow
        title="Block 34"
        segments={[
          { text: 'Block', match: false },
          { text: ' 34', match: true },
        ]}
        renderSegment={(s) => (s.match ? <b>{s.text}</b> : <i>{s.text}</i>)}
      />,
    );
    expect(document.querySelector('b')?.textContent).toBe(' 34');
    const keyWarnings = errors.mock.calls.filter((c) => c.some((a) => /unique "key"/.test(String(a))));
    expect(keyWarnings).toEqual([]);
  });

  it('supports a custom segment renderer and selection', async () => {
    const onSelect = vi.fn();
    render(
      <ResultRow
        title="LPU Ground"
        segments={[
          { text: 'LPU', match: true },
          { text: ' Ground', match: false },
        ]}
        renderSegment={(s, i) =>
          s.match ? <strong key={i}>{s.text}</strong> : <span key={i}>{s.text}</span>
        }
        onSelect={onSelect}
      />,
    );
    expect(document.querySelector('strong')?.textContent).toBe('LPU');
    await userEvent.click(screen.getByRole('button', { name: 'LPU Ground' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe('status components', () => {
  it('VerificationBadge always shows a text label', () => {
    render(
      <>
        <VerificationBadge status="verified" />
        <VerificationBadge status="imported" />
        <VerificationBadge status="estimated" />
        <VerificationBadge status="unverified" />
      </>,
    );
    for (const label of ['Verified', 'Imported', 'Estimated', 'Unverified']) {
      expect(screen.getByText(label)).toBeVisible();
    }
  });

  it('Spinner and Skeleton expose busy status with text', () => {
    render(
      <>
        <Spinner label="Loading campus data" />
        <Skeleton label="Loading results" lines={2} />
      </>,
    );
    const statuses = screen.getAllByRole('status');
    expect(statuses).toHaveLength(2);
    statuses.forEach((s) => expect(s).toHaveAttribute('aria-busy', 'true'));
    expect(statuses[0]).toHaveTextContent('Loading campus data');
    expect(statuses[1]).toHaveTextContent('Loading results');
    expect(screen.getAllByTestId('skeleton-line')).toHaveLength(2);
  });

  it('ErrorState is an alert with a working retry', async () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Could not load the campus dataset." onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the campus dataset.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('ErrorState without onRetry shows no retry button', () => {
    render(<ErrorState message="Offline" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('EmptyState renders title, description and action', () => {
    render(
      <EmptyState
        title="No drinking-water points mapped"
        description="None are recorded in the current data."
        action={<button type="button">Suggest one</button>}
      />,
    );
    expect(screen.getByText('No drinking-water points mapped')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suggest one' })).toBeInTheDocument();
  });
});
