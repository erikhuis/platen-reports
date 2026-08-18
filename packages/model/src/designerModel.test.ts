import { describe, expect, it } from 'vitest';
import {
  countChangedProps, ELEMENT_DEFAULTS, findJsonObjectRange, findSelection,
  resolveLocalized, walkElements, type ReportDefinitionDoc,
} from './designerModel';

const doc: ReportDefinitionDoc = {
  key: 'test-report',
  version: '1.0.0',
  title: { en: 'Test', nl: 'Toets' },
  body: [
    {
      id: 'card', type: 'container', title: { en: 'Card' }, children: [
        { id: 'f1', type: 'field', path: 'item.name' },
        {
          id: 'tbl', type: 'table', bind: 'item.lines',
          columns: [
            { id: 'col-a', header: { en: 'A' }, path: 'a' },
            { id: 'col-b', header: 'B', template: '{{ a }}' },
          ],
        },
        {
          id: 'kv', type: 'keyValueGrid',
          pairs: [{ id: 'kv-x', label: 'X', path: 'item.x' }],
        },
      ],
    },
  ],
};

describe('designerModel', () => {
  it('resolveLocalized: exact language, en fallback, first-entry fallback, plain string', () => {
    expect(resolveLocalized({ en: 'Hello', nl: 'Hallo' }, 'nl')).toBe('Hallo');
    expect(resolveLocalized({ en: 'Hello' }, 'de')).toBe('Hello');
    expect(resolveLocalized({ fr: 'Salut' }, 'de')).toBe('Salut');
    expect(resolveLocalized('Plain', 'es')).toBe('Plain');
    expect(resolveLocalized(undefined, 'en')).toBe('');
  });

  it('walkElements yields nested elements depth-first', () => {
    const ids = [...walkElements(doc)].map((e) => e.id);
    expect(ids).toEqual(['card', 'f1', 'tbl', 'kv']);
  });

  it('findSelection resolves elements, table columns, and grid pairs by id', () => {
    expect(findSelection(doc, 'f1')?.element.id).toBe('f1');
    const col = findSelection(doc, 'col-b');
    expect(col?.element.id).toBe('tbl');
    expect(col?.column?.id).toBe('col-b');
    const pair = findSelection(doc, 'kv-x');
    expect(pair?.element.id).toBe('kv');
    expect(pair?.pair?.id).toBe('kv-x');
    expect(findSelection(doc, 'nope')).toBeNull();
  });

  it('countChangedProps counts only present-and-different values', () => {
    const style = { fontSize: 14, bold: false, align: undefined };
    expect(countChangedProps(style, ELEMENT_DEFAULTS.style!, ['fontSize', 'bold', 'align'])).toBe(1);
  });

  it('findJsonObjectRange brace-matches the object owning the id', () => {
    const json = JSON.stringify(doc, null, 2);
    const range = findJsonObjectRange(json, 'col-b');
    expect(range).not.toBeNull();
    const slice = json.slice(range!.from, range!.to);
    expect(slice).toContain('"id": "col-b"');
    expect(slice).toContain('"template"');
    expect(slice).not.toContain('"col-a"');
    expect(slice.startsWith('{')).toBe(true);
    expect(slice.endsWith('}')).toBe(true);
    expect(findJsonObjectRange(json, 'missing')).toBeNull();
  });

  // Regression: a naive brace count treats `{`/`}` inside a JSON string value as structural,
  // desyncing the depth counter on any unbalanced brace in report text/template content.
  it('findJsonObjectRange ignores braces that appear inside string values', () => {
    const withBraceInText: ReportDefinitionDoc = {
      key: 'r', version: '1.0.0',
      body: [
        { id: 'note', type: 'text', text: 'Closing } only' },
        { id: 'note2', type: 'text', text: 'Opening { only' },
      ],
    };
    const json = JSON.stringify(withBraceInText, null, 2);

    const range1 = findJsonObjectRange(json, 'note');
    expect(range1).not.toBeNull();
    const slice1 = json.slice(range1!.from, range1!.to);
    expect(slice1.startsWith('{')).toBe(true);
    expect(slice1.endsWith('}')).toBe(true);
    expect(JSON.parse(slice1)).toEqual({ id: 'note', type: 'text', text: 'Closing } only' });

    const range2 = findJsonObjectRange(json, 'note2');
    expect(range2).not.toBeNull();
    const slice2 = json.slice(range2!.from, range2!.to);
    expect(JSON.parse(slice2)).toEqual({ id: 'note2', type: 'text', text: 'Opening { only' });
  });
});
