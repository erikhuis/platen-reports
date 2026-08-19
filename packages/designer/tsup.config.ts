import { defineConfig } from 'tsup';
import { preserveDirectivesPlugin } from 'esbuild-plugin-preserve-directives';

// ESM only, matching @platen-reports/model.
//
// The plugin is the whole reason this file is not three lines. esbuild strips top-level
// directives — `'use client'` included — because it treats them as ordinary string-expression
// statements and drops them as dead code. A bundle without them still imports, still
// typechecks, still passes every test in this repo, and then fails at runtime the moment it is
// rendered inside a Next.js Server Component tree: the exact consumer this package is for.
// `packaging.test.ts` asserts the directive against dist/, not against source, for that reason.
//
// The plugin alone is enough — measured. An esbuild `banner` was tried first and produced a
// duplicate directive, since the plugin already emits one.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  // Off: treeshaking rewrites the entry in a way that drops the directive again.
  treeshake: false,
  external: ['react', 'react-dom', '@mui/material', '@emotion/react', '@emotion/styled'],
  esbuildPlugins: [
    preserveDirectivesPlugin({
      directives: ['use client', 'use strict'],
      include: /\.(js|ts|jsx|tsx)$/,
      exclude: /node_modules/,
    }),
  ],
});
