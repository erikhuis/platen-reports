import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import type { ReportPreviewBlob } from './contracts';

/**
 * What a consumer's compiler sees in the declarations we publish.
 *
 * These compile `dist/index.d.ts` itself, not the source it came from. The distinction is the
 * whole point: #10 was a `Promise<Blob>` that every build in this repository accepted — the
 * package compiles with `"types": ["node"]`, the designer with `"lib": [..., "DOM"]` — and that
 * only failed in a *consumer's* build, out of our own `.d.ts`. Nothing that reads the source can
 * catch that class of bug.
 *
 * Requires a build first; `dist/` is asserted, the same way packaging.test.ts asserts the bundle.
 */

const packageDir = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const declarationsFile = join(packageDir, 'dist', 'index.d.ts');

/**
 * The strictest realistic consumer, and the profile #10 was measured with: a Node-side tool
 * that pins `lib` to the language, pulls in no ambient `@types`, and does check the declaration
 * files it installs. Anything our `.d.ts` names beyond ES2022 fails here.
 */
function diagnoseStrictConsumer(): string[] {
  expect(
    existsSync(declarationsFile),
    `${declarationsFile} is missing — build the package before running these tests`,
  ).toBe(true);

  const { options, errors } = ts.convertCompilerOptionsFromJson(
    {
      target: 'ES2022',
      lib: ['ES2022'],
      types: [],
      module: 'ESNext',
      moduleResolution: 'Bundler',
      strict: true,
      // Not skipping lib checks is what puts our declarations under the compiler at all. The
      // default of true is exactly why this is easy to ship broken.
      skipLibCheck: false,
      noEmit: true,
    },
    packageDir,
  );
  expect(errors.map((e) => ts.flattenDiagnosticMessageText(e.messageText, ' '))).toEqual([]);

  const program = ts.createProgram([declarationsFile], options);
  return [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()].map((d) => {
    const message = ts.flattenDiagnosticMessageText(d.messageText, ' ');
    if (!d.file || d.start === undefined) {
      return `TS${d.code}: ${message}`;
    }
    const { line, character } = ts.getLineAndCharacterOfPosition(d.file, d.start);
    return `TS${d.code} (${line + 1},${character + 1}): ${message}`;
  });
}

describe('published declarations', () => {
  it('compile against ES2022 alone, with no DOM lib and no @types/node', () => {
    // The failure this pins: `Promise<Blob>` gave consumers
    // `TS2304: Cannot find name 'Blob'.` — from a file they did not write.
    expect(diagnoseStrictConsumer()).toEqual([]);
  });

  it('still accepts a host whose client returns a real Blob', () => {
    // Widening the return type must not break the hosts that already implement this port.
    // A real Blob satisfies the structural shape, so nothing changes for them at runtime.
    const pdf = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
    const payload: ReportPreviewBlob = pdf;

    expect(typeof payload.size).toBe('number');
    expect(typeof payload.type).toBe('string');
    expect(typeof payload.arrayBuffer).toBe('function');
    expect(payload.type).toBe('application/pdf');
  });
});
