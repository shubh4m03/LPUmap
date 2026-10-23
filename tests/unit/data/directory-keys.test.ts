// @vitest-environment node
/** Map keys (Decision D6): grid, Hilbert order, lock stability, retirement and transfer. Synthetic anchors. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../../../src/config/index.ts';
import { DIRECTORY_KEY_RE, directoryKeysLockSchema } from '../../../src/data/schema.ts';
import type { LngLat } from '../../../src/data/schema.ts';
import { createLocalProjection } from '../../../src/distance/geodesic.ts';
import {
  assignKeys,
  emptyLock,
  gridCellOf,
  hilbertD,
  isKeyEligible,
  keyCell,
  readLock,
} from '../../../scripts/lib/directory-keys.ts';
import type { KeyCandidate } from '../../../scripts/lib/directory-keys.ts';

const origin = APP_CONFIG.directory.gridOrigin;
const proj = createLocalProjection([origin[0], origin[1]]);
/** Anchor x metres east and y metres south of the grid origin. */
const at = (x: number, y: number): LngLat => proj.toLngLat([x, -y]);
const cand = (id: string, x: number, y: number, extra: Partial<KeyCandidate> = {}): KeyCandidate => ({
  id,
  anchor: at(x, y),
  areaM2: 100,
  named: false,
  hasFacility: false,
  ...extra,
});
const tmp = mkdtempSync(join(tmpdir(), 'keys-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('grid cells', () => {
  it('runs columns west → east from A and rows north → south from 1, 200 m each', () => {
    expect(gridCellOf(at(10, 10)).cell).toBe('A1');
    expect(gridCellOf(at(410, 10)).cell).toBe('C1');
    expect(gridCellOf(at(10, 610)).cell).toBe('A4');
    expect(gridCellOf(at(-5, 10)).cell).toBeNull(); // west of the fixed origin: not keyable, never guessed
    expect(gridCellOf(at(10, -5)).cell).toBeNull();
  });
});

describe('Hilbert order', () => {
  it('visits every cell of a small grid exactly once with unit steps', () => {
    const n = 8;
    const seen = new Map<number, [number, number]>();
    for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) seen.set(hilbertD(n, x, y), [x, y]);
    expect(seen.size).toBe(n * n);
    for (let d = 1; d < n * n; d++) {
      const [ax, ay] = seen.get(d - 1)!;
      const [bx, by] = seen.get(d)!;
      expect(Math.abs(ax - bx) + Math.abs(ay - by)).toBe(1);
    }
  });
});

describe('eligibility', () => {
  it('keys inventory buildings of 20 m² or more, or named, or hosting a facility', () => {
    expect(isKeyEligible(cand('a', 1, 1))).toBe(true);
    expect(isKeyEligible(cand('a', 1, 1, { areaM2: 12 }))).toBe(false);
    expect(isKeyEligible(cand('a', 1, 1, { areaM2: 12, named: true }))).toBe(true);
    expect(isKeyEligible(cand('a', 1, 1, { areaM2: 12, hasFacility: true }))).toBe(true);
  });
});

describe('assignKeys', () => {
  const first = [
    cand('osm:way/3', 20, 20),
    cand('osm:way/1', 150, 150),
    cand('osm:way/2', 30, 30),
    cand('osm:way/9', 450, 30),
  ];

  it('assigns cell-letter-row-sequence keys in Hilbert order, unique and lock-valid', () => {
    const r = assignKeys(null, first, { date: '2026-10-24' });
    const keys = r.lock.keys;
    expect(Object.values(keys).every((k) => DIRECTORY_KEY_RE.test(k))).toBe(true);
    expect(new Set(Object.values(keys)).size).toBe(4);
    expect(keyCell(keys['osm:way/9']!)).toBe('C1');
    expect(['A1-01', 'A1-02', 'A1-03']).toEqual(
      ['osm:way/3', 'osm:way/2', 'osm:way/1'].map((id) => keys[id]).sort(),
    );
    expect(directoryKeysLockSchema.safeParse(r.lock).success).toBe(true);
  });

  it('never moves an existing key: newcomers are appended and vanished keys retired, not reused', () => {
    const v1 = assignKeys(null, first, { date: '2026-10-24' }).lock;
    const removed = v1.keys['osm:way/2']!;
    const next = [...first.filter((c) => c.id !== 'osm:way/2'), cand('osm:way/7', 25, 25)];
    const v2 = assignKeys(v1, next, { date: '2026-11-01' });
    for (const id of ['osm:way/3', 'osm:way/1', 'osm:way/9']) expect(v2.lock.keys[id]).toBe(v1.keys[id]);
    expect(v2.lock.retired[removed]).toEqual({ id: 'osm:way/2', retiredAt: '2026-11-01' });
    expect(v2.lock.keys['osm:way/7']).toBe('A1-04'); // next free sequence, never the retired one
    expect(v2.added).toEqual([{ id: 'osm:way/7', key: 'A1-04' }]);
    // Idempotent: the same input gives the same lock.
    expect(assignKeys(v2.lock, next, { date: '2026-12-01' }).lock).toEqual(v2.lock);
  });

  it('transfers a key to a replacing footprint with IoU ≥ 0.5 (D6 rule 4)', () => {
    const v1 = assignKeys(null, first, { date: '2026-10-24' }).lock;
    const next = [...first.filter((c) => c.id !== 'osm:way/2'), cand('osm:way/8', 30, 30)];
    const r = assignKeys(v1, next, {
      date: '2026-11-01',
      iou: (oldId, newId) => (oldId === 'osm:way/2' && newId === 'osm:way/8' ? 0.8 : 0),
    });
    expect(r.lock.keys['osm:way/8']).toBe(v1.keys['osm:way/2']);
    expect(r.transferred).toEqual([
      { from: 'osm:way/2', to: 'osm:way/8', key: v1.keys['osm:way/2'], iou: 0.8 },
    ]);
    expect(r.retired).toEqual([]);
  });

  it('lists anchors outside the grid as unkeyable and renumbers only on request', () => {
    const r = assignKeys(null, [...first, cand('osm:way/99', -50, 20)], { date: '2026-10-24' });
    expect(r.unkeyable).toEqual(['osm:way/99']);
    const re = assignKeys(r.lock, first, { date: '2026-10-25', renumber: true });
    expect(re.lock.version).toBe(2);
    expect(re.lock.retired).toEqual({});
  });

  it('refuses a lock whose grid differs from the config', () => {
    const path = join(tmp, 'lock.json');
    writeFileSync(path, JSON.stringify({ ...emptyLock(), cellM: 150 }));
    expect(() => readLock(path)).toThrow(/differs from APP_CONFIG.directory/);
    writeFileSync(path, JSON.stringify(emptyLock()));
    expect(readLock(path)).toMatchObject({ version: 1, keys: {} });
    expect(readLock(join(tmp, 'missing.json'))).toBeNull();
  });
});
