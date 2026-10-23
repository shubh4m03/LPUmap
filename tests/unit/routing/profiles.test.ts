import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../../../src/config/index.ts';
import { haversineM } from '../../../src/distance/geodesic.ts';
import { edgeRule, maxSpeedMps } from '../../../src/routing/profiles.ts';
import { createRouter } from '../../../src/routing/index.ts';
import { at, caveatCodes, expectFailure, expectOk, loadFixture, makeGraph, pt } from './helpers.ts';

const R = APP_CONFIG.routing;
const campus = createRouter(loadFixture('synthetic-campus.json'));

describe('edgeRule', () => {
  const base = makeGraph(
    [
      [0, 0],
      [10, 0],
    ],
    [[0, 1]],
  ).edges[0]!;

  it('walk ignores vehicle/bicycle oneway but respects onewayFoot', () => {
    expect(edgeRule('walk', { ...base, onewayBicycle: true })).toMatchObject({
      forward: true,
      backward: true,
    });
    expect(edgeRule('walk', { ...base, onewayFoot: true })).toMatchObject({ forward: true, backward: false });
  });

  it('cycle forbids bicycle=no, pushes on push and steps, respects onewayBicycle', () => {
    expect(edgeRule('cycle', { ...base, bicycle: 'no' })).toBeNull();
    expect(edgeRule('cycle', { ...base, bicycle: 'push' })).toMatchObject({ push: true });
    expect(edgeRule('cycle', { ...base, bicycle: 'ride', steps: true })).toMatchObject({ push: true });
    expect(edgeRule('cycle', { ...base, bicycle: 'no', steps: true })).toBeNull();
    const ride = edgeRule('cycle', { ...base, bicycle: 'ride', onewayBicycle: true });
    expect(ride).toMatchObject({ push: false, backward: false });
    expect(ride?.secondsPerM).toBeCloseTo(1 / R.cycleSpeedMps, 12);
  });

  it('step-free excludes steps and wheelchair=no but keeps unknown/limited', () => {
    expect(edgeRule('step-free', { ...base, steps: true })).toBeNull();
    expect(edgeRule('step-free', { ...base, wheelchair: 'no' })).toBeNull();
    expect(edgeRule('step-free', { ...base, wheelchair: 'limited' })).not.toBeNull();
    expect(edgeRule('step-free', { ...base, foot: false })).toBeNull();
  });

  it('treats malformed flags as not allowed', () => {
    expect(edgeRule('walk', { ...base, foot: 'yes' as unknown as boolean })).toBeNull();
    expect(edgeRule('cycle', { ...base, bicycle: 'maybe' as never })).toBeNull();
  });

  it('bounds the heuristic speed by the fastest profile speed', () => {
    expect(maxSpeedMps('walk')).toBe(R.walkSpeedMps);
    expect(maxSpeedMps('cycle')).toBe(Math.max(R.cycleSpeedMps, R.pushBikeSpeedMps));
  });
});

describe('walk vs cycle direction rules', () => {
  it('walking uses the avenue against its bicycle one-way', () => {
    const r = expectOk(campus.route({ from: pt(300, 0), to: pt(0, 0), profile: 'walk' }));
    expect(r.edgeIds).toEqual([2, 1, 0]);
  });

  it('cycling respects the one-way and pushes round the footway loop instead', () => {
    const r = expectOk(campus.route({ from: pt(300, 0), to: pt(0, 0), profile: 'cycle' }));
    expect(r.edgeIds).toEqual([5, 4, 3]);
    expect(caveatCodes(r)).toContain('push-bike');
    expect(r.caveats.find((c) => c.code === 'push-bike')?.message).toContain('460 m');
    expect(r.durationS).toBeCloseTo(r.distanceM / R.pushBikeSpeedMps, 6);
    expect(r.steps.map((s) => s.kind)).toEqual(['push-bike']);
  });

  it('cycling with the one-way rides without push caveats', () => {
    const r = expectOk(campus.route({ from: pt(0, 0), to: pt(300, 0), profile: 'cycle' }));
    expect(r.edgeIds).toEqual([0, 1, 2]);
    expect(caveatCodes(r)).not.toContain('push-bike');
  });

  it('respects onewayFoot when walking', () => {
    const g = makeGraph(
      [
        [0, 0],
        [100, 0],
        [50, 60],
      ],
      [
        [0, 1, { onewayFoot: true }],
        [0, 2],
        [2, 1],
      ],
    );
    const router = createRouter(g);
    expect(expectOk(router.route({ from: pt(0, 0), to: pt(100, 0), profile: 'walk' })).edgeIds).toEqual([0]);
    expect(expectOk(router.route({ from: pt(100, 0), to: pt(0, 0), profile: 'walk' })).edgeIds).toEqual([
      2, 1,
    ]);
  });

  it('fails with no-path when cycling is forbidden on the only link', () => {
    const g = makeGraph(
      [
        [0, 0],
        [100, 0],
        [200, 0],
        [260, 0],
      ],
      [
        [0, 1, { bicycle: 'ride' }],
        [1, 2, { bicycle: 'no' }],
        [2, 3, { bicycle: 'ride' }],
      ],
    );
    const router = createRouter(g);
    expectFailure(router.route({ from: pt(0, 0), to: pt(260, 0), profile: 'cycle' }), 'no-path');
    expect(expectOk(router.route({ from: pt(0, 0), to: pt(260, 0), profile: 'walk' })).edgeIds).toEqual([
      0, 1, 2,
    ]);
  });

  it('cycles over steps only by pushing, and never over bicycle=no steps', () => {
    const toSouth = expectOk(campus.route({ from: pt(0, 0), to: pt(250, -260), profile: 'cycle' }));
    expect(toSouth.edgeIds).toEqual([11, 9, 10]);
    expect(caveatCodes(toSouth)).toEqual(expect.arrayContaining(['contains-steps', 'push-bike']));
    expect(toSouth.steps.map((s) => s.kind)).toEqual(['path', 'steps', 'push-bike']);
    // Edge 6 is steps with bicycle=no: the cycle route 0→7 must not use it.
    const r = expectOk(campus.route({ from: pt(100, 0), to: pt(150, -120), profile: 'cycle' }));
    expect(r.edgeIds).not.toContain(6);
  });
});

describe('step-free', () => {
  it('avoids steps when an alternative exists', () => {
    const r = expectOk(campus.route({ from: pt(0, 0), to: pt(150, -120), profile: 'step-free' }));
    expect(r.edgeIds).toEqual([0, 1, 8]);
    expect(caveatCodes(r)).not.toContain('contains-steps');
    expect(r.durationS).toBeCloseTo(r.distanceM / R.walkSpeedMps, 6);
  });

  it('fails with no-path when the only way uses steps', () => {
    const r = campus.route({ from: pt(0, 0), to: pt(250, -260), profile: 'step-free' });
    expectFailure(r, 'no-path');
    if (!r.ok) expect(r.message).toMatch(/steps/);
  });

  it('excludes wheelchair=no edges', () => {
    const g = makeGraph(
      [
        [0, 0],
        [100, 0],
        [50, 70],
      ],
      [
        [0, 1, { wheelchair: 'no' }],
        [0, 2, { wheelchair: 'yes' }],
        [2, 1, { wheelchair: 'yes' }],
      ],
    );
    const r = expectOk(createRouter(g).route({ from: pt(0, 0), to: pt(100, 0), profile: 'step-free' }));
    expect(r.edgeIds).toEqual([1, 2]);
    expect(caveatCodes(r)).not.toContain('accessibility-unverified');
  });

  it.each(['unknown', 'limited'] as const)(
    'adds accessibility-unverified when an edge is %s',
    (wheelchair) => {
      const g = makeGraph(
        [
          [0, 0],
          [100, 0],
          [200, 0],
        ],
        [
          [0, 1, { wheelchair: 'yes' }],
          [1, 2, { wheelchair }],
        ],
      );
      const r = expectOk(createRouter(g).route({ from: pt(0, 0), to: pt(200, 0), profile: 'step-free' }));
      expect(caveatCodes(r)).toContain('accessibility-unverified');
    },
  );

  it('adds accessibility-unverified for long off-network connectors even on verified edges', () => {
    const g = makeGraph(
      [
        [0, 0],
        [100, 0],
      ],
      [[0, 1, { wheelchair: 'yes' }]],
    );
    const r = expectOk(createRouter(g).route({ from: pt(0, 40), to: pt(100, 0), profile: 'step-free' }));
    expect(caveatCodes(r)).toEqual(expect.arrayContaining(['accessibility-unverified', 'start-connector']));
  });
});

describe('preferences', () => {
  // Steps (50 m) vs a step-free detour (2 × ~41 m): shortest takes the steps, fastest avoids them.
  const g = makeGraph(
    [
      [0, 0],
      [50, 0],
      [25, 30],
    ],
    [
      [0, 1, { steps: true, highway: 'steps' }],
      [0, 2],
      [2, 1],
    ],
  );
  const router = createRouter(g);

  it('shortest minimises metres', () => {
    const r = expectOk(
      router.route({ from: pt(0, 0), to: pt(50, 0), profile: 'walk', preference: 'shortest' }),
    );
    expect(r.edgeIds).toEqual([0]);
  });

  it('fastest minimises seconds including the steps penalty', () => {
    const r = expectOk(
      router.route({ from: pt(0, 0), to: pt(50, 0), profile: 'walk', preference: 'fastest' }),
    );
    expect(r.edgeIds).toEqual([1, 2]);
    expect(r.preference).toBe('fastest');
    const detour = haversineM(at(0, 0), at(25, 30)) + haversineM(at(25, 30), at(50, 0));
    expect(r.durationS).toBeCloseTo(detour / R.walkSpeedMps, 6);
  });
});
