/** Domain-context helpers for tests: a controllable clock and an owner actor. */
import type { BaseData } from '../../../server/base-data.ts';
import type { DomainContext } from '../../../server/domain/context.ts';
import type { IdGenerator } from '../../../server/ids.ts';

export const OWNER = 'owner@example.org';
export const T0 = Date.parse('2026-10-01T10:00:00.000Z');

/** Each call returns a context whose clock is one second later than the previous one. */
export function clock(base: BaseData, start = T0) {
  let t = start;
  return {
    owner(extra: Partial<DomainContext> = {}): DomainContext {
      t += 1000;
      return { now: new Date(t), actor: OWNER, base, ...extra };
    },
    anon(extra: Partial<DomainContext> = {}): DomainContext {
      t += 1000;
      return { now: new Date(t), base, ...extra };
    },
    advance(ms: number) {
      t += ms;
    },
    get now() {
      return new Date(t);
    },
  };
}

/** Id generator returning the given ids in order (then falls back to an error). */
export function fixedIds(...ids: string[]): IdGenerator {
  const queue = [...ids];
  return {
    next() {
      const id = queue.shift();
      if (!id) throw new Error('fixedIds exhausted');
      return id;
    },
  };
}

/** A valid contribution body inside the synthetic campus. */
export const contribution = (over: Record<string, unknown> = {}) => ({
  name: 'Campus Pharmacy',
  categoryId: 'health',
  location: [75.7004, 31.2503],
  description: 'Small pharmacy next to the library',
  ...over,
});
