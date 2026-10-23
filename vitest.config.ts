import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: [
      'tests/unit/**/*.test.{ts,tsx}',
      'tests/integration/**/*.test.{ts,tsx}',
      // Building-coverage suite on the real processed dataset (public/data).
      'tests/coverage/**/*.test.ts',
    ],
    setupFiles: ['tests/setup.ts'],
    restoreMocks: true,
    testTimeout: 20000,
  },
});
