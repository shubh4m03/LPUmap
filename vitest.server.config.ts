import { defineConfig } from 'vitest/config';

/** Backend tests (server/, functions/): Node environment, local D1 via wrangler getPlatformProxy. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/server/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
    restoreMocks: true,
  },
});
