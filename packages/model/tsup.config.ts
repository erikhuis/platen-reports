import { defineConfig } from 'tsup';

// ESM only, with declarations. No CJS build: this package is consumed by the designer and by
// the conformance suite, both of which are ESM, and shipping dual formats doubles the surface
// for no known consumer.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
});
