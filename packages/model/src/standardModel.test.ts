import { describe, expect, it } from 'vitest';
import type { ReportDefinitionDoc } from './designerModel';
import {
  deleteNode, insertNode, reorderSiblings, sectionOf, serializeDefinition, setNodeProp,
  validateDefinition,
} from './standardModel';

const doc = (): ReportDefinitionDoc => ({
  schemaVersion: 1, key: 'r', version: '1.0.0', title: 'R', dataSource: 'src',
  pageHeader: { id: 'hdr', type: 'row', children: [{ id: 'hdr-title', type: 'text', text: 'T' }] },
  body: [
    { id: 'a', type: 'text', text: 'A' },
    {
      id: 'tbl', type: 'table', bind: 'item.lines',
      columns: [{ id: 'c1', header: 'C1', path: 'x' }, { id: 'c2', header: 'C2', path: 'y' }],
    },
    { id: 'b', type: 'text', text: 'B' },
  ],
  pageFooter: { id: 'ftr', type: 'pageNumber' },
});

describe('standardModel', () => {
  it('setNodeProp mutates directly and elides defaults (never written)', () => {
    let d = setNodeProp(doc(), 'a', 'style.fontSize', 14, 9);
    const a = d.body!.find((n) => n.id === 'a') as { style?: { fontSize?: number } };
    expect(a.style?.fontSize).toBe(14);
    // Back to default → the style prop (and empty style object) is removed.
    d = setNodeProp(d, 'a', 'style.fontSize', 9, 9);
    expect((d.body!.find((n) => n.id === 'a') as { style?: unknown }).style).toBeUndefined();
  });

  it('deleteNode removes an element, a table column, or a fixed-slot header/footer', () => {
    expect(deleteNode(doc(), 'a').body!.some((n) => n.id === 'a')).toBe(false);
    const noCol = deleteNode(doc(), 'c1');
    expect((noCol.body!.find((n) => n.id === 'tbl') as { columns: { id: string }[] }).columns.map((c) => c.id)).toEqual(['c2']);
    expect(deleteNode(doc(), 'ftr').pageFooter).toBeUndefined();
  });

  it('insertNode places relative to an anchor and appends into $body', () => {
    const after = insertNode(doc(), { id: 'new', type: 'text', text: 'N' }, { anchor: 'a', position: 'after', section: 'body' });
    expect(after.body!.map((n) => n.id)).toEqual(['a', 'new', 'tbl', 'b']);
    const appended = insertNode(doc(), { id: 'z', type: 'text', text: 'Z' }, { anchor: '$body', position: 'appendInto', section: 'body' });
    expect(appended.body!.map((n) => n.id)).toEqual(['a', 'tbl', 'b', 'z']);
    // Column insert into a table.
    const col = insertNode(doc(), { id: 'c3', header: 'C3', path: 'z' }, { anchor: 'c1', position: 'after', section: 'body' });
    expect((col.body!.find((n) => n.id === 'tbl') as { columns: { id: string }[] }).columns.map((c) => c.id)).toEqual(['c1', 'c3', 'c2']);
  });

  // Regression: locate() wraps pageHeader/pageFooter in a throwaway array (needed so
  // setNodeProp can mutate the shared node reference); insertNode's before/after path used
  // to splice into that throwaway array, so the insert silently vanished instead of failing
  // or placing. Mirrors overlayModel.ts's InsertInvalidTarget rejection for the same anchor.
  it('insertNode no-ops (does not silently corrupt) on before/after anchored at a fixed-slot root', () => {
    const before = insertNode(doc(), { id: 'new', type: 'text', text: 'N' }, { anchor: 'hdr', position: 'after', section: 'header' });
    expect(before).toEqual(doc());
    const afterFooter = insertNode(doc(), { id: 'new2', type: 'text', text: 'N' }, { anchor: 'ftr', position: 'before', section: 'footer' });
    expect(afterFooter).toEqual(doc());
  });

  // Regression: the $body branch used to ignore `position` entirely and always append —
  // unlike overlayModel.ts's insertIntoSequence, which rejects non-appendInto positions on
  // $body. Both engines share the InsertTarget contract and must reject the same input.
  it('insertNode no-ops on $body with a position other than appendInto', () => {
    const result = insertNode(doc(), { id: 'new', type: 'text', text: 'N' }, { anchor: '$body', position: 'before', section: 'body' });
    expect(result).toEqual(doc());
  });

  it('reorderSiblings moves within the same parent only', () => {
    const moved = reorderSiblings(doc(), 'body', 0, 2);
    expect(moved.body!.map((n) => n.id)).toEqual(['tbl', 'b', 'a']);
    const cols = reorderSiblings(doc(), 'tbl', 1, 0);
    expect((cols.body!.find((n) => n.id === 'tbl') as { columns: { id: string }[] }).columns.map((c) => c.id)).toEqual(['c2', 'c1']);
    // Out-of-range is a no-op.
    expect(reorderSiblings(doc(), 'body', 0, 9).body!.map((n) => n.id)).toEqual(['a', 'tbl', 'b']);
  });

  it('sectionOf reports header/body/footer', () => {
    expect(sectionOf(doc(), 'hdr-title')).toBe('header');
    expect(sectionOf(doc(), 'a')).toBe('body');
    expect(sectionOf(doc(), 'ftr')).toBe('footer');
  });

  it('validateDefinition mirrors the parser fatal rules over the whole doc', () => {
    const bad = doc();
    bad.body!.push({ id: 'empty', type: 'text', text: '' });
    bad.body!.push({ id: 'nofield', type: 'field', path: '' });
    bad.body!.push({ id: 'pgn', type: 'pageNumber' }); // pageNumber in body
    bad.body!.push({ id: 'a', type: 'text', text: 'dup' }); // duplicate id
    const codes = validateDefinition(bad).map((p) => p.code);
    expect(codes).toContain('textElementEmpty');
    expect(codes).toContain('fieldMissingPath');
    expect(codes).toContain('pageNumberInBody');
    expect(codes).toContain('duplicateId');
    // A clean doc has no problems.
    expect(validateDefinition(doc())).toEqual([]);
  });

  it('validateDefinition flags blank doc-level settings and parameter names (gates Export)', () => {
    const bad = doc() as unknown as {
      key: string; version: string; dataSource: string; parameters?: { name: string; type: string }[];
    };
    bad.key = '';
    bad.dataSource = '  ';
    bad.parameters = [{ name: '', type: 'guid' }];
    const codes = validateDefinition(bad as unknown as ReportDefinitionDoc).map((p) => p.code);
    expect(codes).toContain('documentMissingKey');
    expect(codes).toContain('documentMissingDataSource');
    expect(codes).toContain('parameterMissingName');
  });

  it('serializeDefinition strips default-equal props for a tidy committed file', () => {
    const d = doc();
    (d.body![1] as { repeatHeader?: boolean }).repeatHeader = true; // table default
    const json = JSON.parse(serializeDefinition(d));
    const tbl = json.body.find((n: { id: string }) => n.id === 'tbl');
    expect(tbl.repeatHeader).toBeUndefined();
  });

  // Regression: keyValueGrid.columns is a NUMBER (column count), not a table's column
  // array. Naively iterating node.columns crashed serialize/locate ("N is not iterable")
  // on any real definition with a grid (asset-print) — caught in preview, not unit tests.
  it('handles keyValueGrid (numeric columns) in serialize, locate and delete', () => {
    const withGrid = (): ReportDefinitionDoc => ({
      schemaVersion: 1, key: 'r', version: '1.0.0', title: 'R', dataSource: 'src',
      body: [{
        id: 'kv', type: 'keyValueGrid', columns: 2,
        pairs: [{ id: 'p1', label: 'L1', path: 'a' }, { id: 'p2', label: 'L2', path: 'b' }],
      }],
    });
    // serialize must not throw, and the default column count (2) is elided.
    const json = JSON.parse(serializeDefinition(withGrid()));
    expect(json.body[0].columns).toBeUndefined();
    expect(json.body[0].pairs.map((p: { id: string }) => p.id)).toEqual(['p1', 'p2']);
    // locate must find a pair nested under the grid (edit + delete round-trip).
    const edited = setNodeProp(withGrid(), 'p1', 'path', 'zzz', undefined);
    const kv = edited.body!.find((n) => n.id === 'kv') as { pairs: { id: string; path: string }[] };
    expect(kv.pairs.find((p) => p.id === 'p1')!.path).toBe('zzz');
    const afterDelete = deleteNode(withGrid(), 'p1');
    const kv2 = afterDelete.body!.find((n) => n.id === 'kv') as { pairs: { id: string }[] };
    expect(kv2.pairs.map((p) => p.id)).toEqual(['p2']);
  });

  // Regression: pairs have no `type` discriminant, so keying ELEMENT_DEFAULTS off `node.type`
  // never matched pair.format's default ('') — it was silently never stripped.
  it('serializeDefinition elides a keyValueGrid pair format equal to its default', () => {
    const withGrid = (): ReportDefinitionDoc => ({
      schemaVersion: 1, key: 'r', version: '1.0.0', title: 'R', dataSource: 'src',
      body: [{
        id: 'kv', type: 'keyValueGrid',
        pairs: [{ id: 'p1', label: 'L1', path: 'a', format: '' }],
      }],
    });
    const json = JSON.parse(serializeDefinition(withGrid()));
    expect(json.body[0].pairs[0].format).toBeUndefined();
  });
});
