import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';

import { KNOWN_ELEMENT_TYPES } from './designerModel';
import type { ReportElementNode, ReportElementType } from './designerModel';
import { validateDefinition } from './standardModel';
import type { ReportDefinitionDoc } from './designerModel';

/**
 * The element-type gate, and the thing that keeps it honest.
 *
 * `validateInserted` and `validateDefinition` both refuse an element whose `type` is outside the
 * vocabulary. That gate used to be a hand-written `Set` of eleven strings, duplicated in both
 * files, with nothing tying either copy to `ReportElementNode` — so a twelfth element type would
 * have made both validators report valid content as `unknownElementType` (#11).
 *
 * The fix is a `Record` keyed off the union, which only works while the annotation stays. A test
 * that just calls the validators cannot see the difference: widen the constant to
 * `Record<string, true>` and every runtime assertion here still passes while the guard is gone.
 * So the first test drives the compiler.
 */

const sourceDir = fileURLToPath(new URL('.', import.meta.url));
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** Type-checks a snippet against this package's real `ReportElementType`, returning `TSxxxx` codes. */
function compile(snippet: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'platen-gate-'));
  tempDirs.push(dir);
  const file = join(dir, 'probe.ts');
  writeFileSync(file, snippet.replace('@@MODEL@@', join(sourceDir, 'designerModel').replace(/\\/g, '/')));

  const { options } = ts.convertCompilerOptionsFromJson(
    {
      target: 'ES2022', lib: ['ES2022'], module: 'ESNext', moduleResolution: 'Bundler',
      strict: true, skipLibCheck: true, noEmit: true, types: [],
    },
    dir,
  );
  const program = ts.createProgram([file], options);
  const probe = program.getSourceFile(file);
  if (!probe) throw new Error('the probe never made it into the compiler program');
  return program.getSemanticDiagnostics(probe).map((d) => `TS${d.code}`);
}

/** `true` only when the two types are mutually assignable — neither wider nor narrower. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

describe('element-type gate', () => {
  it('will not compile a vocabulary that has drifted from the union', () => {
    // Omitting one member stands in for the case the issue is about: a twelfth element type
    // added to ReportElementNode without updating the vocabulary. Both produce TS2741 — the
    // literal no longer covers the union.
    const missing = compile(`
      import type { ReportElementType } from '@@MODEL@@';
      export const drifted: Record<ReportElementType, true> = {
        text: true, field: true, row: true, column: true, container: true, table: true,
        keyValueGrid: true, spacer: true, line: true, image: true,
      };
    `);
    expect(missing).toContain('TS2741');

    // And a type that is not in the union cannot be smuggled in either.
    const spurious = compile(`
      import type { ReportElementType } from '@@MODEL@@';
      export const drifted: Record<ReportElementType, true> = {
        text: true, field: true, row: true, column: true, container: true, table: true,
        keyValueGrid: true, spacer: true, line: true, image: true, pageNumber: true,
        barChart: true,
      };
    `);
    expect(spurious).toContain('TS2353');

    // Guard against the guard being vacuous: the same shape with every member present and
    // nothing extra must compile clean, or the two assertions above prove nothing.
    expect(compile(`
      import type { ReportElementType } from '@@MODEL@@';
      export const exact: Record<ReportElementType, true> = {
        text: true, field: true, row: true, column: true, container: true, table: true,
        keyValueGrid: true, spacer: true, line: true, image: true, pageNumber: true,
      };
    `)).toEqual([]);
  });

  it('pins the vocabulary to the union, so the annotation cannot be widened away', () => {
    // The compile probe above proves `Record<ReportElementType, true>` is a working guard; it
    // says nothing about whether this constant still uses one. Widen the annotation to
    // `Record<string, true>` and the probe keeps passing while exhaustiveness quietly stops
    // being checked — every other assertion in this file would still be green. Mutual `extends`
    // is what notices: `keyof` becomes `string`, which does not extend the union, so this fails
    // `tsc --noEmit`.
    const exact: Exact<keyof typeof KNOWN_ELEMENT_TYPES, ReportElementType> = true;
    expect(exact).toBe(true);
  });

  it('accepts only own properties, so an element typed toString is unknown', () => {
    // Membership is Object.hasOwn, not `in` and not a truthiness lookup. `'toString' in obj` is
    // true for every object literal, which would wave inherited names through the gate.
    expect(Object.hasOwn(KNOWN_ELEMENT_TYPES, 'text')).toBe(true);
    for (const inherited of ['toString', 'constructor', 'valueOf', '__proto__']) {
      expect(Object.hasOwn(KNOWN_ELEMENT_TYPES, inherited)).toBe(false);
    }
  });

  it('covers every type the validators switch on', () => {
    expect(Object.keys(KNOWN_ELEMENT_TYPES).sort()).toEqual([
      'column', 'container', 'field', 'image', 'keyValueGrid',
      'line', 'pageNumber', 'row', 'spacer', 'table', 'text',
    ]);
  });

  it('validateDefinition flags an unknown type and passes every known one', () => {
    // The overlay side of this gate was covered; the direct-authoring side was not.
    const withType = (type: string): ReportDefinitionDoc => ({
      schemaVersion: 1, key: 'r', version: '1.0.0', title: 'R', dataSource: 'src',
      body: [{ id: 'el-1', type } as unknown as ReportElementNode],
    });

    const bogus = validateDefinition(withType('bogusType'));
    expect(bogus.some((p) => p.code === 'unknownElementType' && p.id === 'el-1')).toBe(true);

    // No known type may be reported as unknown — the drift failure this issue is about would
    // show up here as a valid element being rejected.
    for (const type of Object.keys(KNOWN_ELEMENT_TYPES)) {
      const problems = validateDefinition(withType(type));
      expect(problems.some((p) => p.code === 'unknownElementType'), `${type} rejected`).toBe(false);
    }
  });
});
