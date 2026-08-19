import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createTheme } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';

const pkgRoot = join(__dirname, '..');
const dist = join(pkgRoot, 'dist');
const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  files?: string[];
};

/**
 * Properties that only fail for a consumer.
 *
 * None of these can be caught by a component test, and none of them can be trusted to review:
 * they are facts about the published artefact, so they are asserted against `dist/`. That means
 * `pnpm build` has to have run — which it has in CI, where build precedes test.
 */
describe('packaging', () => {
  const built = existsSync(join(dist, 'index.js'));

  it.runIf(built)('keeps the "use client" directive in the built bundle', () => {
    const bundle = readFileSync(join(dist, 'index.js'), 'utf8');
    const firstStatement = bundle.trimStart().split('\n')[0]!.trim();

    // esbuild treats a top-level directive as a dead string expression and drops it. A bundle
    // without this imports, typechecks and passes every other test here — then fails at runtime
    // inside a Next.js Server Component tree, which is the most likely place this is used.
    expect(firstStatement).toMatch(/^['"]use client['"];?$/);
  });

  it.runIf(built)('ships no stylesheet', () => {
    // Everything is sx/emotion. A CSS file would need a host to import it, which is a wiring
    // step nothing in the API tells them about.
    const css = readdirSync(dist).filter((f) => f.endsWith('.css'));
    expect(css).toEqual([]);
  });

  it('keeps React, MUI and emotion as peers, and lucide as a real dependency', () => {
    // Peers because a host must not end up with two Reacts or two emotion caches.
    for (const peer of ['react', 'react-dom', '@mui/material', '@emotion/react', '@emotion/styled']) {
      expect(pkg.peerDependencies).toHaveProperty(peer);
      expect(pkg.dependencies ?? {}).not.toHaveProperty(peer);
    }
    // lucide has no such constraint: it renders SVG and holds no shared state.
    expect(pkg.dependencies).toHaveProperty('lucide-react');
    expect(pkg.peerDependencies ?? {}).not.toHaveProperty('lucide-react');
  });

  it('accepts the React and MUI majors a host is likely to be on', () => {
    expect(pkg.peerDependencies!.react).toContain('19');
    expect(pkg.peerDependencies!['@mui/material']).toContain('7');
  });
});

/**
 * The designer must render against a stock `createTheme()`.
 *
 * The issue named four tokens; this asserts the property that list was standing in for — every
 * palette path the package reaches for resolves in an unmodified theme — so it cannot go stale
 * the way a hand-maintained list does. It caught `text.primary` and `primary.main`, which the
 * list had missed and which are perfectly fine.
 */
describe('theme tokens', () => {
  const theme = createTheme();

  const resolve = (path: string): unknown =>
    path.split('.').reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      theme.palette as unknown,
    );

  const tokens = (() => {
    const found = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith('.tsx') || entry.name.includes('.test.')) continue;
        for (const match of readFileSync(full, 'utf8')
          .matchAll(/'(divider|(?:background|text|action|primary|secondary|error|warning|success|info|grey)\.[A-Za-z0-9]+)'/g)) {
          found.add(match[1]!);
        }
      }
    };
    walk(__dirname);
    return [...found].sort();
  })();

  it('reaches for at least one token, so the check is not vacuous', () => {
    expect(tokens.length).toBeGreaterThan(0);
  });

  it.each(tokens)('%s resolves in an unmodified createTheme()', (token) => {
    expect(resolve(token)).toBeDefined();
  });
});
