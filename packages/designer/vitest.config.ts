import { defineConfig } from 'vitest/config';

// jsdom here, unlike @platen-reports/model's `node`: these are React components and the tests
// drive them through Testing Library.
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
