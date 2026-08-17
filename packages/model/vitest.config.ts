import { defineConfig } from 'vitest/config';

// `node`, deliberately — not jsdom. This package must run outside a browser: the conformance
// suite drives the TypeScript merger and the C# merger over the same fixtures and compares, and
// that runs in plain Node. A DOM shim here would let a browser-only dependency creep in unnoticed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
