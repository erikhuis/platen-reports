import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
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
 * Every module `source` actually reaches for: static imports, `export … from`, dynamic
 * `import()` and `require()`.
 *
 * Parsed, not pattern-matched. Scanning text for `from '…'` cannot tell code from a string that
 * looks like code, and both directions of that have bitten this guard: it first failed against
 * its own prose describing what it looks for, and a later regex that stripped template literals
 * to accommodate elementTypeGate.test.ts's embedded snippets would silently swallow a real
 * `require` sitting between two unbalanced backticks — a zero-dependency guard reporting clean
 * because it could not see the dependency. The compiler already answers this question exactly,
 * and `typescript` is a devDependency here for the declarations test, so ask it.
 */
function moduleSpecifiers(source: string, fileName: string): string[] {
  const parsed = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true);
  const specifiers: string[] = [];

  const visit = (node: ts.Node): void => {
    // `import … from 'x'`, a bare `import 'x'`, and `export … from 'x'`.
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    }
    // `import('x')` and `require('x')`. A non-literal argument cannot be resolved statically
    // and is not something this package does, so it is left alone deliberately.
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const [first] = node.arguments;
      if ((isRequire || isDynamicImport) && first && ts.isStringLiteral(first)) {
        specifiers.push(first.text);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(parsed);
  return specifiers;
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

    for (const file of readdirSync(sourceDir).filter((f) => f.endsWith('.ts'))) {
      const source = readFileSync(join(sourceDir, file), 'utf8');
      for (const specifier of moduleSpecifiers(source, file)) {
        // Relative specifiers stay inside the package by definition.
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
