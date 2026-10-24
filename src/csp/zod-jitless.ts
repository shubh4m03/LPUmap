/**
 * Turns off Zod's JIT before any schema exists.
 *
 * Zod 4 probes for `new Function` support the first time an object schema is
 * created. The probe's throw is caught, but a strict CSP (`script-src 'self'`,
 * public/_headers) still reports it as a `securitypolicyviolation` on every
 * page. With `jitless` set first, Zod skips the probe and parses without
 * generated code. This module must run before Zod's classic API is evaluated,
 * which src/csp/zod.ts guarantees by importing it first.
 */
import { config } from 'zod/v4/core';

config({ jitless: true });
