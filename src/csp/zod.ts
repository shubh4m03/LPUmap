/**
 * `zod` as the browser bundle sees it: vite.config.ts aliases the bare `zod`
 * import to this module, so every schema in the app is created after
 * zod-jitless.ts has switched the JIT off (no CSP eval probe). The API is
 * Zod's own (`zod/v4` is the same classic API as `zod`); type checking,
 * Vitest and the server keep importing `zod` directly.
 */
import './zod-jitless.ts';

export * from 'zod/v4';
export { default } from 'zod/v4';
