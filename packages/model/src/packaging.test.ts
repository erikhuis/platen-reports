import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The properties this package exists to have.
 *
 * A prose grep for "react" would fail on a comment explaining why there is no React, so these
 * assert the things that actually matter: nothing is declared as a dependency, and no module
 * imports anything outside this package. Both are checked against the real files, not a copy.
 */

const packageDir = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const sourceDir = join(packageDir, 'src');

/**
 * Removes comments and template literals so the import scan sees code, not prose or test data.
 *
 * Comments go first, because they routinely contain backticks — this file's own do — which would
 * unbalance the template pass. Nothing lost this way can be a real import: `import x from` a
 * template literal is not valid syntax, so a specifier inside one is always a string that merely
 * looks like an import. elementTypeGate.test.ts embeds whole TypeScript snippets to feed the
 * compiler, and all three tripped this scan before templates were stripped.
 */
function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/`(?:[^`\\]|\\[\s\S])*`/g, '``');
}

const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

describe('packaging', () => {
  it('declares no runtime dependencies and no peers', () => {
    // A consumer of the model — the conformance suite, a build script, a server — must be able
    // to take this package without inheriting a framework.
    expect(manifest.dependencies ?? {}).toEqual({});
    expect(manifest.peerDependencies ?? {}).toEqual({});
  });

  it('keeps its dev dependencies to types and the compiler', () => {
    // Anything else here is a hint that something crept into the source. TypeScript earns its
    // place: declarations.test.ts compiles the emitted .d.ts as a strict consumer would, which
    // needs a compiler, and leaning on the workspace root to resolve one is an undeclared
    // dependency. Neither ships — `files` is dist + README + LICENCE.
    expect(Object.keys(manifest.devDependencies ?? {})).toEqual(['@types/node', 'typescript']);
  });

  it('imports nothing outside this package', () => {
    const offenders: string[] = [];

    // Every syntactic shape that can reach for a module: `import x from '...'`, a bare
    // side-effect `import '...'`, a dynamic `import('...')`, and CommonJS `require('...')`.
    // A `from`-only scan misses the first two entirely — a bare or dynamic import of an
    // external package would resolve (or fail to) without ever matching `from`.
    const importPatterns = [
      /\bfrom\s+['"]([^'"]+)['"]/g,
      /^\s*import\s+['"]([^'"]+)['"]/gm,
      /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];

    for (const file of readdirSync(sourceDir).filter((f) => f.endsWith('.ts'))) {
      // Comments are stripped first. Without that the scan matches prose and commented-out
      // code — including this file's own description of what it looks for, which is how the
      // guard first failed against itself.
      const source = stripNonCode(readFileSync(join(sourceDir, file), 'utf8'));
      // A module specifier that is not relative. Test files may reach for the runner and for
      // node builtins; nothing that ships may reach for anything at all.
      for (const pattern of importPatterns) {
        for (const match of source.matchAll(pattern)) {
          const specifier = match[1]!;
          if (specifier.startsWith('.')) {
            continue;
          }
          // Test files may reach for the runner, node builtins, and the compiler that
          // declarations.test.ts runs over dist/. Nothing that ships may reach for anything.
          const allowedInTests = file.endsWith('.test.ts')
            && (specifier === 'vitest' || specifier === 'typescript' || specifier.startsWith('node:'));
          if (!allowedInTests) {
            offenders.push(`${file} → ${specifier}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('ships no framework in the built bundle', () => {
    // Belt and braces: even if a source import slipped past, a bundled import would show here.
    const bundle = readFileSync(join(packageDir, 'dist', 'index.js'), 'utf8');

    expect(bundle).not.toMatch(/from\s*["']react["']/);
    expect(bundle).not.toMatch(/from\s*["']@mui\//);
    expect(bundle).not.toMatch(/from\s*["']next\//);
  });
});
