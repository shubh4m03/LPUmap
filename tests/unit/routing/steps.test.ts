import { describe, expect, it } from 'vitest';
import { classifyTurn, formatStepDistance, genericNoun, headingChange } from '../../../src/routing/steps.ts';
import { createRouter } from '../../../src/routing/index.ts';
import { expectOk, loadFixture, makeGraph, pt } from './helpers.ts';

describe('turn classification', () => {
  it('computes signed heading change across north', () => {
    expect(headingChange(350, 10)).toBeCloseTo(20, 9);
    expect(headingChange(10, 350)).toBeCloseTo(-20, 9);
    expect(headingChange(0, 180)).toBe(180);
    expect(headingChange(90, 90)).toBe(0);
  });

  it.each([
    [0, 'straight'],
    [19, 'straight'],
    [-25, 'slight-left'],
    [30, 'slight-right'],
    [-90, 'left'],
    [90, 'right'],
    [150, 'sharp-right'],
    [-170, 'sharp-left'],
  ] as const)('%d° → %s', (delta, expected) => {
    expect(classifyTurn(delta)).toBe(expected);
  });
});

describe('generic names', () => {
  it('never invents names for unnamed ways', () => {
    expect(genericNoun('footway', false)).toBe('the footway');
    expect(genericNoun('residential', false)).toBe('the road');
    expect(genericNoun('tertiary_link', false)).toBe('the road');
    expect(genericNoun('path', false)).toBe('the path');
    expect(genericNoun('track', false)).toBe('the path');
    expect(genericNoun('footway', true)).toBe('the steps');
  });

  it('formats step distances', () => {
    expect(formatStepDistance(0.2)).toBe('1 m');
    expect(formatStepDistance(119.6)).toBe('120 m');
    expect(formatStepDistance(1540)).toBe('1.5 km');
  });
});

describe('route steps', () => {
  it('merges consecutive edges with the same kind and name', () => {
    const router = createRouter(loadFixture('synthetic-campus.json'));
    const r = expectOk(router.route({ from: pt(0, 0), to: pt(300, 0), profile: 'walk' }));
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0]).toMatchObject({ kind: 'road', name: 'Synthetic Avenue', startIndex: 0 });
    expect(r.steps[0]!.instruction).toBe('Head along Synthetic Avenue for 300 m');
  });

  it('describes turns, steps and unnamed footways', () => {
    // East 100 m on a named road, left (north) 60 m on an unnamed footway,
    // then right (east) up 12 m of steps, then straight on a named path.
    const g = makeGraph(
      [
        [0, 0],
        [100, 0],
        [100, 60],
        [112, 60],
        [180, 60],
      ],
      [
        [0, 1, { highway: 'residential', name: 'Test Road' }],
        [1, 2],
        [2, 3, { highway: 'steps', steps: true }],
        [3, 4, { highway: 'path', name: 'Upper Test Path' }],
      ],
    );
    const r = expectOk(createRouter(g).route({ from: pt(0, 0), to: pt(180, 60), profile: 'walk' }));
    expect(r.steps.map((s) => s.instruction)).toEqual([
      'Head along Test Road for 100 m',
      'Turn left onto the footway (60 m)',
      'Turn right and take the steps (12 m)',
      'Continue along Upper Test Path for 68 m',
    ]);
    expect(r.steps.map((s) => s.startIndex)).toEqual([0, 1, 2, 3]);
  });

  it('describes sharp and slight turns', () => {
    const g = makeGraph(
      [
        [0, 0],
        [100, 0],
        [20, 30],
        [120, 60],
      ],
      [
        [0, 1, { name: 'A Test Way' }],
        [1, 2, { name: 'B Test Way' }],
        [2, 3, { name: 'C Test Way' }],
      ],
    );
    const r = expectOk(createRouter(g).route({ from: pt(0, 0), to: pt(120, 60), profile: 'walk' }));
    expect(r.steps[1]!.instruction).toMatch(/^Turn sharp left onto B Test Way/);
    expect(r.steps[2]!.instruction).toMatch(/^Turn sharp right onto C Test Way/);
  });

  it('describes connector legs and the destination label', () => {
    const router = createRouter(loadFixture('synthetic-campus.json'));
    const r = expectOk(
      router.route({ from: pt(-30, 0), to: { ...pt(300, -40), label: 'Test Hall' }, profile: 'walk' }),
    );
    expect(r.steps[0]!.instruction).toBe('Walk 30 m in a straight line to the nearest mapped path');
    expect(r.steps[r.steps.length - 1]!.instruction).toBe(
      'Leave the mapped path and walk 40 m in a straight line to Test Hall',
    );
    expect(r.steps[1]!.instruction).toBe('Continue along Synthetic Avenue for 300 m');
  });

  it('tells cyclists to walk their bicycle', () => {
    const router = createRouter(loadFixture('synthetic-campus.json'));
    const r = expectOk(router.route({ from: pt(300, 0), to: pt(0, 0), profile: 'cycle' }));
    expect(r.steps[0]!.instruction).toBe('Walk your bicycle along the footway for 460 m');
    const south = expectOk(router.route({ from: pt(0, 0), to: pt(250, -260), profile: 'cycle' }));
    expect(south.steps.map((s) => s.instruction)).toEqual([
      'Head along Test Cycleway for 192 m',
      'Turn right and take the steps, walking your bicycle (140 m)',
      'Turn left, then walk your bicycle along South Test Path for 100 m',
    ]);
  });
});
