/** Map-editing props of the owner's point editors, the position fields and the access-point picker. */
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessPointPicker } from '../../../src/admin/map/AccessPointPicker.tsx';
import type { AccessChoice } from '../../../src/admin/map/access-choice.ts';
import { PositionFields } from '../../../src/admin/map/PositionFields.tsx';
import { usePointEditing } from '../../../src/admin/map/usePointEditing.ts';
import type { LngLat } from '../../../src/data/schema.ts';

afterEach(cleanup);

const drag = (phase: 'start' | 'move' | 'end' | 'cancel', current: LngLat) => ({
  handleId: 'move',
  kind: 'move' as const,
  phase,
  start: [75.7, 31.25] as LngLat,
  current,
  modifiers: { shift: false, alt: false },
});

describe('usePointEditing', () => {
  it('desktop: click places, drag moves, a cancelled drag returns to the start; never selects places', () => {
    const onPoint = vi.fn();
    const { result } = renderHook(() =>
      usePointEditing({ point: [75.7, 31.25], editable: true, reticle: false, onPoint }),
    );
    const e = result.current.editing;
    expect(e.input).toBe('pointer');
    expect(e.handles).toEqual([
      { id: 'move', kind: 'move', position: [75.7, 31.25], label: 'Drag to move the point' },
    ]);
    act(() => e.onPointer!({ type: 'click', lngLat: [75.71234567891, 31.2], placeId: 'osm:way/1' }));
    expect(onPoint).toHaveBeenLastCalledWith([75.7123457, 31.2]);
    act(() => e.onHandleDrag!(drag('start', [75.7, 31.25])));
    expect(onPoint).toHaveBeenCalledTimes(1);
    act(() => e.onHandleDrag!(drag('move', [75.701, 31.251])));
    act(() => e.onHandleDrag!(drag('cancel', [75.7, 31.25])));
    expect(onPoint.mock.calls.slice(1)).toEqual([[[75.701, 31.251]], [[75.7, 31.25]]]);
  });

  it('read-only maps report clicks for picking and show no handle', () => {
    const onPick = vi.fn();
    const onPoint = vi.fn();
    const { result } = renderHook(() =>
      usePointEditing({ point: [75.7, 31.25], editable: false, reticle: false, onPick, onPoint }),
    );
    expect(result.current.editing.handles).toEqual([]);
    act(() => result.current.editing.onPointer!({ type: 'click', lngLat: [1, 2], placeId: null }));
    expect(onPick).toHaveBeenCalledWith([1, 2]);
    expect(onPoint).not.toHaveBeenCalled();
  });

  it('phones: the centre pin reports the map centre; taps do not move the point', () => {
    const onPoint = vi.fn();
    const { result } = renderHook(() =>
      usePointEditing({ point: null, editable: true, reticle: true, onPoint }),
    );
    expect(result.current.editing.input).toBe('reticle');
    act(() => result.current.editing.onReticleChange!([75.7000000001, 31.25]));
    expect(result.current.reticleCenter).toEqual([75.7, 31.25]);
    act(() => result.current.editing.onPointer!({ type: 'click', lngLat: [1, 2], placeId: null }));
    expect(onPoint).not.toHaveBeenCalled();
  });
});

describe('PositionFields', () => {
  function Harness({ initial, center }: { initial: LngLat | null; center: LngLat | null }) {
    const [p, setP] = useState<LngLat | null>(initial);
    return (
      <>
        <PositionFields value={p} onChange={setP} mapCenter={center} reticle={center !== null} />
        <output>{p ? p.join(',') : 'none'}</output>
      </>
    );
  }

  it('typed coordinates commit on Enter; invalid ones are explained and not applied', async () => {
    const user = userEvent.setup();
    render(<Harness initial={null} center={null} />);
    expect(screen.queryByRole('button', { name: /centre/ })).toBeNull();
    await user.type(screen.getByLabelText('Latitude'), '95');
    await user.type(screen.getByLabelText('Longitude'), '75.7{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a latitude between -90 and 90');
    expect(screen.getByText('none')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Latitude'));
    await user.type(screen.getByLabelText('Latitude'), '31.25{Enter}');
    expect(screen.getByText('75.7,31.25')).toBeInTheDocument();
  });

  it('phones: "Place at the centre pin" and 1 m steps', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[75.7, 31.25]} center={[75.701, 31.251]} />);
    await user.click(screen.getByRole('button', { name: 'Place at the centre pin' }));
    expect(screen.getByText('75.701,31.251')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Move 1 m north' }));
    expect(screen.getByLabelText('Latitude')).toHaveValue(
      String(Math.round((31.251 + 1 / 111_320) * 1e7) / 1e7),
    );
  });
});

describe('AccessPointPicker', () => {
  function Harness(props: { current?: { nodeId: number; problem: string | null } | null }) {
    const [v, setV] = useState<AccessChoice>({ kind: 'unset' });
    return (
      <>
        <AccessPointPicker
          location={[75.7, 31.25]}
          candidates={[
            { nodeId: 4, position: [75.7001, 31.25], distanceM: 9.5 },
            { nodeId: 2, position: [75.7003, 31.25], distanceM: 28.4 },
          ]}
          value={v}
          onChange={setV}
          current={props.current ?? null}
        />
        <output>{JSON.stringify(v)}</output>
      </>
    );
  }

  it('nothing is preselected; the owner picks a validated node or none', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => (r as HTMLInputElement).checked)).toEqual([false, false, false]);
    expect(
      screen.getByRole('radio', { name: 'Path node 4 (nearest)', description: '9.5 m from the place' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Path node 2/ }));
    await user.type(screen.getByLabelText(/Access note/), 'Gate');
    expect(screen.getByText('{"kind":"node","nodeId":2,"note":"Gate"}')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /No access point/ }));
    expect(screen.getByText('{"kind":"none"}')).toBeInTheDocument();
  });

  it('a stored node is offered as "keep" with the server-equivalent verdict', () => {
    render(<Harness current={{ nodeId: 7, problem: 'Path node 7 is 80 m from the location.' }} />);
    expect(
      screen.getByRole('radio', { name: /Keep the current access point \(path node 7\)/ }),
    ).toHaveAccessibleDescription(/Not valid at this position: Path node 7 is 80 m/);
    expect(screen.getByRole('radio', { name: /Remove the access point/ })).toBeInTheDocument();
  });
});
