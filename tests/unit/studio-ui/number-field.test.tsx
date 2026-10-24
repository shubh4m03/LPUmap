/**
 * Studio numeric fields: a coordinate field (step 0.00001°) shows and nudges
 * on its own step, never on a 0.001° (~100 m) grid. Regression: ArrowUp on a
 * longitude of 75.70452 used to report 75.705 (a ~45 m jump) instead of
 * 75.70453, and the field showed only three decimals.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NumberField } from '../../../src/admin/studio/controls.tsx';

afterEach(cleanup);

function setup(value: number, step?: number) {
  const onValue = vi.fn<(v: number) => string | null>(() => null);
  const view = render(<NumberField label="Field" value={value} step={step} onValue={onValue} testId="f" />);
  return { onValue, input: screen.getByTestId('f') as HTMLInputElement, view };
}

describe('NumberField precision', () => {
  it('shows a coordinate to its step (5 decimals for 0.00001°)', () => {
    const { input } = setup(75.70452, 0.00001);
    expect(input.value).toBe('75.70452');
  });

  it('ArrowUp/ArrowDown on a coordinate move by one step from the exact value', () => {
    const { input, onValue } = setup(75.70452, 0.00001);
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onValue).toHaveBeenLastCalledWith(75.70453);
    expect(input.value).toBe('75.70453');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(onValue).toHaveBeenLastCalledWith(75.70451);
  });

  it('steps from the exact value when the display is rounded', () => {
    const { input, onValue } = setup(31.254051234, 0.00001);
    expect(input.value).toBe('31.25405');
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onValue).toHaveBeenLastCalledWith(31.25406);
  });

  it('keeps three decimals for metre and degree fields (default step 0.1)', () => {
    const { input, onValue } = setup(12.34567);
    expect(input.value).toBe('12.346');
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onValue).toHaveBeenLastCalledWith(12.446);
  });

  it('a typed value steps from what was typed', () => {
    const { input, onValue } = setup(10, 1);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '14' } });
    expect(onValue).toHaveBeenLastCalledWith(14);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onValue).toHaveBeenLastCalledWith(15);
  });
});
