import { describe, expect, it } from 'vitest';
import { DESIGNER_MESSAGES, createDesignerTranslate } from '../messages';
import { TYPE_ICONS } from './designerConstants';
import { PROBLEM_MESSAGE_KEYS } from './DesignerShell';

/**
 * Catalogue coverage for the two lookups the model does not own.
 *
 * The model emits machine codes, so the designer resolves wording itself:
 * ``t(`elementType.${type}`)`` for element labels and `PROBLEM_MESSAGE_KEYS[code]` for
 * validation problems. `Record<OverlayProblemCode, string>` proves every code has a *key*,
 * and `TYPE_ICONS` (a `Record<ReportElementType, …>`) proves the type list is complete — but
 * neither proves the key resolves. A missing entry would render a raw `elementType.foo` in
 * the UI, silently, in one locale. These tests are that guard, and they are why deleting
 * `TYPE_LABEL_KEYS` did not cost coverage: the check moved from "a key exists" to "the
 * wording exists, in all four locales".
 *
 * Each assertion compares a list of offenders against `[]` so a failure names the exact
 * locale and key rather than just reporting `false`.
 */

// The package's own bundles — in the origin codebase this read the host application's
// catalogue. Shipping the wording is what makes this a guard rather than a check on someone
// else's file.
const LOCALES = Object.entries(DESIGNER_MESSAGES);
const reportsOf = (messages: (typeof DESIGNER_MESSAGES)[string]) => messages;

describe('designer message catalogue', () => {
  // Derived from TYPE_ICONS (a Record over ReportElementType), so adding an element type
  // to the model widens this test on its own — no count to bump by hand.
  const elementTypes = Object.keys(TYPE_ICONS);

  it('has an element-type label for every renderable type, in all four locales', () => {
    // Non-vacuity: an empty list would make every check below pass while testing nothing.
    expect(elementTypes.length).toBeGreaterThan(0);

    const missing = LOCALES.flatMap(([locale, messages]) => {
      const labels = reportsOf(messages).elementType ?? {};
      return elementTypes.filter((type) => !labels[type]).map((type) => `${locale}: elementType.${type}`);
    });
    expect(missing).toEqual([]);
  });

  it('leaves no orphaned element-type label behind', () => {
    const orphaned = LOCALES.flatMap(([locale, messages]) =>
      Object.keys(reportsOf(messages).elementType ?? {})
        .filter((key) => !elementTypes.includes(key))
        .map((key) => `${locale}: elementType.${key}`));
    expect(orphaned).toEqual([]);
  });

  it('resolves every OverlayProblemCode to wording, in all four locales', () => {
    // The Record over the closed union already guarantees one key per code, so the count is
    // not worth pinning — but each code must map to its OWN key: a copy-paste in the Record
    // would silently label one problem with another's wording, and types cannot catch that.
    const keys = Object.values(PROBLEM_MESSAGE_KEYS);
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);

    const missing = LOCALES.flatMap(([locale, messages]) => {
      const reports = reportsOf(messages);
      return keys.filter((key) => !reports[key]).map((key) => `${locale}: ${key}`);
    });
    expect(missing).toEqual([]);
  });
});
