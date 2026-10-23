/**
 * Map keys (Decision D6, docs/ISOMETRIC_AND_3D_DESIGN.md §7.3): presentation
 * ids such as `C4-07` — NOT official LPU block numbers.
 *
 *  - Grid: 200 m cells from the fixed origin APP_CONFIG.directory.gridOrigin
 *    (north-west corner). Columns A, B, … run west → east, rows 1, 2, … north
 *    → south, measured in a local metre projection centred on the origin.
 *  - Cell: from the building's anchor (point-on-surface, BuildingPropsV2).
 *  - Sequence within a cell: Hilbert-curve order of the anchor on a
 *    1024 × 1024 grid over APP_CONFIG.map.maxBounds (x west → east, y north →
 *    south), ties broken by id, numbered from 01.
 *  - Eligibility: campus inventory AND (area ≥ minKeyAreaM2 OR named OR a
 *    place is located_in / part_of it).
 *
 * The lock (data/curated/directory-keys.json) is the only source of keys:
 * `npm run data:build` READS it; only `npm run data:keys` writes it. New
 * eligible buildings are appended with the next free sequence in their cell;
 * removed buildings' keys are retired and never reused within a lock version.
 */
import { existsSync, readFileSync } from 'node:fs';
import { APP_CONFIG } from '../../src/config/index.ts';
import { directoryKeysLockSchema } from '../../src/data/schema.ts';
import type { DirectoryKeysLock, LngLat } from '../../src/data/schema.ts';
import { createLocalProjection } from '../../src/distance/geodesic.ts';

export const LOCK_FILE = 'directory-keys.json';
export const HILBERT_SIZE = 1024;
export const LOCK_COMMENT =
  'Map keys (presentation ids, NOT official LPU block numbers). Written only by `npm run data:keys`; ' +
  '`npm run data:build` only reads it. Grid, eligibility and stability rules: docs/ISOMETRIC_AND_3D_DESIGN.md §7.3 ' +
  'and scripts/lib/directory-keys.ts. Do not edit by hand.';

export interface GridCell {
  col: number;
  row: number;
  /** 'C4' or null when the anchor lies outside the keyable grid (west/north of the origin or beyond Z/99). */
  cell: string | null;
}

export function gridCellOf(
  p: LngLat,
  origin: readonly [number, number] = APP_CONFIG.directory.gridOrigin,
  cellM: number = APP_CONFIG.directory.cellM,
): GridCell {
  const [x, y] = createLocalProjection([origin[0], origin[1]]).toXY(p);
  const col = Math.floor(x / cellM);
  const row = Math.floor(-y / cellM);
  const ok = col >= 0 && col < 26 && row >= 0 && row < 99;
  return { col, row, cell: ok ? `${String.fromCharCode(65 + col)}${row + 1}` : null };
}

/** Hilbert index of (x, y) on an n × n grid (n a power of two). */
export function hilbertD(n: number, x0: number, y0: number): number {
  let x = x0;
  let y = y0;
  let d = 0;
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (x & s) > 0 ? 1 : 0;
    const ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        x = n - 1 - x;
        y = n - 1 - y;
      }
      [x, y] = [y, x];
    }
  }
  return d;
}

export function hilbertIndexOf(
  p: LngLat,
  frame: readonly [number, number, number, number] = APP_CONFIG.map.maxBounds,
  n: number = HILBERT_SIZE,
): number {
  const [w, s, e, north] = frame;
  const clamp = (v: number) => Math.min(n - 1, Math.max(0, Math.floor(v)));
  const x = clamp(((p[0] - w) / (e - w)) * n);
  const y = clamp(((north - p[1]) / (north - s)) * n);
  return hilbertD(n, x, y);
}

export interface KeyCandidate {
  id: string;
  anchor: LngLat;
  areaM2: number | null;
  named: boolean;
  hasFacility: boolean;
}

export function isKeyEligible(
  c: KeyCandidate,
  minAreaM2: number = APP_CONFIG.directory.minKeyAreaM2,
): boolean {
  return (c.areaM2 !== null && c.areaM2 >= minAreaM2) || c.named || c.hasFacility;
}

const KEY_RE = /^([A-Z][1-9]\d?)-(\d{2})$/;
export const keyCell = (key: string) => KEY_RE.exec(key)?.[1] ?? null;
const keySeq = (key: string) => Number(KEY_RE.exec(key)?.[2] ?? 0);

export function emptyLock(): DirectoryKeysLock {
  return {
    $comment: LOCK_COMMENT,
    version: 1,
    gridOrigin: [APP_CONFIG.directory.gridOrigin[0], APP_CONFIG.directory.gridOrigin[1]],
    cellM: APP_CONFIG.directory.cellM,
    keys: {},
    retired: {},
  };
}

/** Reads and validates the lock; null when the file does not exist. Throws on an invalid or mismatched lock. */
export function readLock(path: string): DirectoryKeysLock | null {
  if (!existsSync(path)) return null;
  const parsed = directoryKeysLockSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) throw new Error(`${path} is not a valid directory-keys lock: ${parsed.error.message}`);
  const lock = parsed.data;
  const [ox, oy] = APP_CONFIG.directory.gridOrigin;
  if (lock.gridOrigin[0] !== ox || lock.gridOrigin[1] !== oy || lock.cellM !== APP_CONFIG.directory.cellM)
    throw new Error(
      `${path}: grid (${lock.gridOrigin.join(', ')}, ${lock.cellM} m) differs from APP_CONFIG.directory; ` +
        'a grid change needs `npm run data:keys -- --renumber`.',
    );
  return lock;
}

export interface KeyAssignment {
  lock: DirectoryKeysLock;
  added: Array<{ id: string; key: string }>;
  retired: Array<{ id: string; key: string }>;
  transferred: Array<{ from: string; to: string; key: string; iou: number }>;
  /** Eligible buildings whose anchor lies outside the keyable grid. */
  unkeyable: string[];
}

export interface AssignOptions {
  /** ISO date recorded on retirements (YYYY-MM-DD). */
  date: string;
  /** Start a new lock version: every key is recomputed from scratch (favourites store ids, not keys). */
  renumber?: boolean;
  /**
   * D6 rule 4: when a keyed id disappears, its key moves to a NEW eligible
   * building whose footprint overlaps the old one with IoU ≥ 0.5. Returns the
   * IoU of two building ids (old id from the previous dataset), or null.
   */
  iou?: (oldId: string, newId: string) => number | null;
}

export const TRANSFER_MIN_IOU = 0.5;

/** Pure: appends new keys, retires vanished ones, never moves an existing key. */
export function assignKeys(
  previous: DirectoryKeysLock | null,
  eligible: readonly KeyCandidate[],
  opts: AssignOptions,
): KeyAssignment {
  const base = !previous || opts.renumber ? emptyLock() : structuredClone(previous);
  if (previous && opts.renumber) base.version = previous.version + 1;
  const eligibleIds = new Set(eligible.map((c) => c.id));
  const added: KeyAssignment['added'] = [];
  const retired: KeyAssignment['retired'] = [];
  const transferred: KeyAssignment['transferred'] = [];
  const unkeyable: string[] = [];

  const vanished = Object.entries(base.keys)
    .filter(([id]) => !eligibleIds.has(id))
    .sort(([a], [b]) => a.localeCompare(b));
  const newcomers = eligible.filter((c) => !(c.id in base.keys));
  for (const [oldId, key] of vanished) {
    delete base.keys[oldId];
    let best: { id: string; iou: number } | null = null;
    if (opts.iou)
      for (const c of newcomers) {
        if (c.id in base.keys) continue;
        const iou = opts.iou(oldId, c.id);
        if (iou !== null && iou >= TRANSFER_MIN_IOU && (!best || iou > best.iou)) best = { id: c.id, iou };
      }
    if (best) {
      base.keys[best.id] = key;
      transferred.push({ from: oldId, to: best.id, key, iou: best.iou });
    } else {
      base.retired[key] = { id: oldId, retiredAt: opts.date };
      retired.push({ id: oldId, key });
    }
  }

  const used = new Map<string, number>(); // cell → highest sequence ever used (keys and retired)
  const note = (key: string) => {
    const cell = keyCell(key);
    if (cell) used.set(cell, Math.max(used.get(cell) ?? 0, keySeq(key)));
  };
  Object.values(base.keys).forEach(note);
  Object.keys(base.retired).forEach(note);

  const pending = eligible
    .filter((c) => !(c.id in base.keys))
    .map((c) => ({ c, cell: gridCellOf(c.anchor).cell, h: hilbertIndexOf(c.anchor) }))
    .sort((a, b) => a.h - b.h || a.c.id.localeCompare(b.c.id));
  for (const { c, cell } of pending) {
    if (!cell) {
      unkeyable.push(c.id);
      continue;
    }
    const seq = (used.get(cell) ?? 0) + 1;
    if (seq > 99) {
      unkeyable.push(c.id);
      continue;
    }
    used.set(cell, seq);
    const key = `${cell}-${String(seq).padStart(2, '0')}`;
    base.keys[c.id] = key;
    added.push({ id: c.id, key });
  }
  base.keys = Object.fromEntries(Object.entries(base.keys).sort(([a], [b]) => a.localeCompare(b)));
  base.retired = Object.fromEntries(Object.entries(base.retired).sort(([a], [b]) => a.localeCompare(b)));
  base.$comment = LOCK_COMMENT;
  return { lock: base, added, retired, transferred, unkeyable: unkeyable.sort() };
}
