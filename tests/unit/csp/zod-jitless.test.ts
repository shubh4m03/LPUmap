/**
 * src/csp/zod.ts (the browser's `zod`, aliased in vite.config.ts) switches
 * Zod's JIT off before any schema exists, so Zod never probes `new Function`
 * (a strict CSP reports that probe as a violation even though it is caught).
 * The end-to-end check under the real CSP is tests/e2e/csp.spec.ts.
 */
import { afterEach, describe, expect, it } from 'vitest';

const RealFunction = globalThis.Function;

afterEach(() => {
  globalThis.Function = RealFunction;
});

describe('browser zod (src/csp/zod.ts)', () => {
  it('never constructs a Function, even when schemas are created and parsed', async () => {
    let constructed = 0;
    globalThis.Function = new Proxy(RealFunction, {
      construct(target, args) {
        constructed++;
        return Reflect.construct(target, args);
      },
      apply(target, self, args) {
        constructed++;
        return Reflect.apply(target, self, args);
      },
    });
    const { z } = await import('../../../src/csp/zod.ts');
    const schema = z.object({ id: z.string(), n: z.number().int(), nested: z.object({ ok: z.boolean() }) });
    expect(schema.parse({ id: 'a', n: 1, nested: { ok: true }, extra: 1 })).toEqual({
      id: 'a',
      n: 1,
      nested: { ok: true },
    });
    expect(schema.safeParse({ id: 1 }).success).toBe(false);
    expect(constructed).toBe(0);
    expect(z.config().jitless).toBe(true);
  });

  it('exposes the same API as zod (named z, default export, top-level helpers)', async () => {
    const shim = await import('../../../src/csp/zod.ts');
    const real = await import('zod');
    expect(shim.default).toBe(shim.z);
    for (const name of Object.keys(real)) expect(shim, name).toHaveProperty(name);
  });
});
