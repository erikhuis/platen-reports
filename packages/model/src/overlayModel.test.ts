import { describe, expect, it } from 'vitest';
import type { ReportDefinitionDoc, ReportElementNode } from './designerModel';
import {
  BODY_PSEUDO_ANCHOR, collectAllIds, collectSubtreeIds, insertElement, isOverlayEmpty, mergePreview, nextId,
  resetElementProp, restoreElement, serializeOverlay, setElementProp, suppressElement,
  validateInserted,
  type ReportOverlayDoc,
} from './overlayModel';

const standard = (): ReportDefinitionDoc => ({
  schemaVersion: 1,
  key: 'test-report',
  version: '1.2.0',
  title: 'Test',
  pageHeader: { id: 'hdr', type: 'row', children: [{ id: 'hdr-title', type: 'text', text: 'Title' }] },
  body: [
    {
      id: 'summary', type: 'keyValueGrid',
      pairs: [
        { id: 'kv-status', label: 'Status', path: 'item.status' },
        { id: 'kv-name', label: 'Name', path: 'item.name' },
      ],
    },
    { id: 'detail-text', type: 'text', text: 'Detail' },
    {
      id: 'lines', type: 'table', bind: 'item.lines',
      columns: [
        { id: 'col-code', header: 'Code', path: 'code' },
        { id: 'col-qty', header: 'Qty', path: 'qty' },
      ],
      totals: [{ columnId: 'col-qty', aggregate: 'sum' }],
    },
  ],
});

const emptyOverlay = (): ReportOverlayDoc => ({ schemaVersion: 1, reportKey: 'test-report' });

describe('overlayModel — merge preview', () => {
  it('applies suppress → insert → setProps in server order, ghost-keeping suppressed nodes', () => {
    const overlay: ReportOverlayDoc = {
      suppress: ['detail-text'],
      insert: [{ id: 'ins-1', anchor: BODY_PSEUDO_ANCHOR, position: 'appendInto', element: { id: 'txt-1', type: 'text', text: 'Added' } }],
      setProps: [{ id: 'txt-1', props: { 'style.bold': true, text: 'Restyled' } }],
    };
    const preview = mergePreview(standard(), overlay);

    // Display keeps the suppressed node (marked); effective removes it.
    expect(preview.displayDoc.body!.some((n) => n.id === 'detail-text')).toBe(true);
    expect(preview.meta.get('detail-text')?.suppressed).toBe(true);
    expect(preview.effectiveDoc.body!.some((n) => n.id === 'detail-text')).toBe(false);

    // Insert landed at the end of body, marked as tenant, and setProps restyled it.
    const inserted = preview.displayDoc.body!.find((n) => n.id === 'txt-1');
    expect(inserted).toBeDefined();
    expect(preview.meta.get('txt-1')?.insertPatchId).toBe('ins-1');
    expect((inserted as { text?: unknown }).text).toBe('Restyled');
    expect((inserted as { style?: { bold?: boolean } }).style?.bold).toBe(true);
    expect(preview.warnings).toHaveLength(0);
  });

  it('mirrors the server warning codes: unknown ids, collisions, disallowed props, stale baseVersion', () => {
    const overlay: ReportOverlayDoc = {
      baseVersion: '1.0.0',
      suppress: ['ghost'],
      insert: [{ id: 'ins-1', anchor: 'nope', position: 'after', element: { id: 'x-1', type: 'text', text: 'x' } },
               { id: 'ins-2', anchor: BODY_PSEUDO_ANCHOR, position: 'appendInto', element: { id: 'detail-text', type: 'text', text: 'dup' } }],
      setProps: [{ id: 'missing', props: { text: 'x' } }, { id: 'detail-text', props: { bind: 'hack' } }],
    };
    const codes = mergePreview(standard(), overlay).warnings.map((w) => w.code).sort();
    expect(codes).toEqual([
      'BaseVersionOutdated', 'InsertAnchorNotFound', 'InsertIdCollision',
      'SetPropsDisallowedProp', 'SetPropsIdNotFound', 'SuppressedIdNotFound',
    ].sort());
  });

  it('blocks suppressing the last visible pair and totals-referenced columns like the server', () => {
    const overlay: ReportOverlayDoc = { suppress: ['kv-status', 'kv-name', 'col-qty'] };
    const preview = mergePreview(standard(), overlay);
    const blocked = preview.warnings.filter((w) => w.code === 'SuppressBlocked').map((w) => w.targetId).sort();
    expect(blocked).toEqual(['col-qty', 'kv-name']);
    expect(preview.meta.get('kv-status')?.suppressed).toBe(true);
    expect(preview.meta.get('kv-name')?.suppressed).toBeUndefined();
  });

  it('inserts before/after table columns and kv pairs by anchor id', () => {
    const overlay: ReportOverlayDoc = {
      insert: [
        { id: 'ins-1', anchor: 'col-code', position: 'after', element: { id: 'col-new', header: 'New', path: 'extra' } },
        { id: 'ins-2', anchor: 'kv-status', position: 'before', element: { id: 'kv-new', label: 'New', path: 'item.x' } },
      ],
    };
    const preview = mergePreview(standard(), overlay);
    const table = preview.displayDoc.body!.find((n) => n.id === 'lines');
    expect((table as { columns: { id: string }[] }).columns.map((c) => c.id)).toEqual(['col-code', 'col-new', 'col-qty']);
    const grid = preview.displayDoc.body!.find((n) => n.id === 'summary');
    expect((grid as { pairs: { id: string }[] }).pairs.map((p) => p.id)).toEqual(['kv-new', 'kv-status', 'kv-name']);
  });
});

describe('overlayModel — merge preview server-parity edge cases', () => {
  // The client keeps suppressed nodes in displayDoc for ghosting, but the SERVER removes
  // them before insert → setProps; these pin the warning behavior to the server's.

  it('an insert anchored on a suppressed id warns InsertAnchorNotFound and does not place', () => {
    const overlay: ReportOverlayDoc = {
      suppress: ['detail-text'],
      insert: [{ id: 'ins-1', anchor: 'detail-text', position: 'after', element: { id: 'txt-x', type: 'text', text: 'x' } }],
    };
    const preview = mergePreview(standard(), overlay);
    const warning = preview.warnings.find((w) => w.code === 'InsertAnchorNotFound');
    expect(warning?.targetId).toBe('detail-text');
    expect(preview.displayDoc.body!.some((n) => n.id === 'txt-x')).toBe(false);
  });

  it('an insert whose NESTED id collides is skipped, reporting the nested colliding id', () => {
    const overlay: ReportOverlayDoc = {
      insert: [{
        id: 'ins-1', anchor: BODY_PSEUDO_ANCHOR, position: 'appendInto',
        // Fresh top-level id, but the nested column reuses an existing id.
        element: { id: 'tbl-new', type: 'table', bind: 'x', columns: [{ id: 'col-qty', header: 'Dup', path: 'q' }] },
      }],
    };
    const preview = mergePreview(standard(), overlay);
    const collision = preview.warnings.find((w) => w.code === 'InsertIdCollision');
    expect(collision?.targetId).toBe('col-qty');
    expect(preview.displayDoc.body!.some((n) => n.id === 'tbl-new')).toBe(false);
  });

  it('appendInto a childless container creates the array; a non-container target is InsertInvalidTarget', () => {
    const std = standard();
    // A container with no `children` key at all — server creates one; the client must too.
    std.body!.push({ id: 'box-1', type: 'container' } as unknown as ReportElementNode);
    const overlay: ReportOverlayDoc = {
      insert: [
        { id: 'ins-1', anchor: 'box-1', position: 'appendInto', element: { id: 'txt-in', type: 'text', text: 'in' } },
        { id: 'ins-2', anchor: 'detail-text', position: 'appendInto', element: { id: 'txt-bad', type: 'text', text: 'bad' } },
      ],
    };
    const preview = mergePreview(std, overlay);
    const box = preview.displayDoc.body!.find((n) => n.id === 'box-1') as { children?: { id: string }[] };
    expect(box.children?.map((c) => c.id)).toEqual(['txt-in']);
    const invalid = preview.warnings.find((w) => w.code === 'InsertInvalidTarget');
    expect(invalid?.targetId).toBe('detail-text');
  });

  it('before/after on a fixed-slot root (pageHeader) is InsertInvalidTarget, never InsertInvalidPosition', () => {
    const overlay: ReportOverlayDoc = {
      insert: [{ id: 'ins-1', anchor: 'hdr', position: 'after', element: { id: 'txt-x', type: 'text', text: 'x' } }],
    };
    const preview = mergePreview(standard(), overlay);
    expect(preview.warnings.find((w) => w.targetId === 'hdr')?.code).toBe('InsertInvalidTarget');
    expect(preview.warnings.some((w) => w.code === 'InsertInvalidPosition')).toBe(false);
  });

  it('setProps on a suppressed id warns SetPropsIdNotFound and does not restyle the ghost', () => {
    const overlay: ReportOverlayDoc = {
      suppress: ['detail-text'],
      setProps: [{ id: 'detail-text', props: { text: 'Restyled' } }],
    };
    const preview = mergePreview(standard(), overlay);
    expect(preview.warnings.some((w) => w.code === 'SetPropsIdNotFound' && w.targetId === 'detail-text')).toBe(true);
    const ghost = preview.displayDoc.body!.find((n) => n.id === 'detail-text') as { text?: unknown };
    expect(ghost.text).toBe('Detail');
  });

  // #34: `mergePreview` runs inside the designer's render path, so a throw here is a blank
  // screen rather than a reported problem. Its two UNTYPED walkers — collectSubtreeIds and
  // setElementProp's findTarget — read `node.columns` on any node, and on a keyValueGrid that
  // field is the column COUNT, a number. `for (const c of 2)` threw. The count is a documented
  // part of the model (KeyValueGridElementNode.columns, ELEMENT_DEFAULTS.keyValueGrid), so this
  // needs no malformed JSON at all: any producer that inserts a grid carrying its own column
  // count crashed the merge. standardModel's `locate` already guarded exactly this shape.
  it('mergePreview inserts a keyValueGrid that carries its numeric column count', () => {
    const overlay: ReportOverlayDoc = {
      insert: [{
        id: 'ins-1', anchor: BODY_PSEUDO_ANCHOR, position: 'appendInto',
        element: { id: 'grid-1', type: 'keyValueGrid', columns: 2, pairs: [{ id: 'gp-1', label: 'L', path: 'x' }] },
      }],
    };
    const preview = mergePreview(standard(), overlay);
    expect(preview.warnings).toHaveLength(0);
    expect(preview.meta.get('grid-1')?.insertPatchId).toBe('ins-1');
    // The count survives the merge untouched — it is a real property, not an item list.
    const grid = preview.displayDoc.body!.find((n) => n.id === 'grid-1') as { columns?: unknown };
    expect(grid.columns).toBe(2);
    expect(validateInserted(preview)).toEqual([]);
  });

  it('collectAllIds sees the pair ids of a pending grid insert that also carries a column count', () => {
    // The same walker backs id minting: if it stops early, nextId can re-mint an id the pending
    // insert already uses, and ids are a stable public contract.
    const overlay: ReportOverlayDoc = {
      insert: [{
        id: 'ins-1', anchor: BODY_PSEUDO_ANCHOR, position: 'appendInto',
        element: { id: 'grid-1', type: 'keyValueGrid', columns: 2, pairs: [{ id: 'kvp-9', label: 'L', path: 'x' }] },
      }],
    };
    const ids = collectAllIds(standard(), overlay);
    expect(ids.has('kvp-9')).toBe(true);
    expect(nextId('kvp', ids)).toBe('kvp-10');
  });

  it('mergePreview survives insert payloads whose columns/pairs are junk', () => {
    // Each of these threw a raw TypeError out of mergePreview before #34 — from
    // collectSubtreeIds for the non-arrays, and from the effectiveDoc prune for the null entry.
    const overlay: ReportOverlayDoc = {
      insert: [
        { id: 'ins-1', anchor: BODY_PSEUDO_ANCHOR, position: 'appendInto', element: { id: 'tbl-1', type: 'table', bind: 'x', columns: {} } },
        { id: 'ins-2', anchor: BODY_PSEUDO_ANCHOR, position: 'appendInto', element: { id: 'tbl-2', type: 'table', bind: 'x', columns: [null] } },
        { id: 'ins-3', anchor: BODY_PSEUDO_ANCHOR, position: 'appendInto', element: { id: 'grid-2', type: 'keyValueGrid', pairs: 'nope' } },
      ],
    };
    const preview = mergePreview(standard(), overlay);
    expect(preview.displayDoc.body!.some((n) => n.id === 'tbl-1')).toBe(true);
    // The unaddressable entry is dropped from the effective doc — nothing can select, edit or
    // suppress a column with no id — and the validator reports it rather than the merge throwing.
    const effective = preview.effectiveDoc.body!.find((n) => n.id === 'tbl-2') as { columns?: unknown[] };
    expect(effective.columns).toEqual([]);
    expect(validateInserted(preview)).toContainEqual({ id: 'tbl-2.columns[0]', code: 'columnMalformed' });
  });

  it('collectSubtreeIds keeps descending through a node that has no id of its own', () => {
    // The collision scan exists to catch a clash on ANY id in the payload, so it must not stop
    // at an id-less node: its descendants carry ids too. Filtering the walk to id-carrying
    // entries silently narrowed it, and a nested clash then merged instead of being skipped.
    const element = { id: 'box-1', type: 'container', children: [{ type: 'row', children: [{ id: 'deep', type: 'text' }] }] };
    expect(collectSubtreeIds(element)).toEqual(['box-1', 'deep']);

    const doc: ReportDefinitionDoc = { schemaVersion: 1, key: 'k', version: '1', body: [{ id: 'deep', type: 'text', text: 'published' }] };
    const preview = mergePreview(doc, {
      insert: [{ id: 'ins-1', anchor: BODY_PSEUDO_ANCHOR, position: 'appendInto', element }],
    });
    expect(preview.warnings.some((w) => w.code === 'InsertIdCollision' && w.targetId === 'deep')).toBe(true);
    expect(preview.displayDoc.body!.some((n) => n.id === 'box-1')).toBe(false);
  });

  it('validateInserted treats an empty-string id as unaddressable, not as a duplicate', () => {
    // `id: ''` is a string, so an id-check that only looks at the type registers it — and the
    // second empty id then collides with the first, reporting a duplicateId whose own anchor is
    // blank. That is the #34 defect wearing a different shape, so the tolerant reader and the
    // classifier have to agree that empty is not addressable.
    const overlay: ReportOverlayDoc = {
      insert: [{
        id: 'ins-1', anchor: BODY_PSEUDO_ANCHOR, position: 'appendInto',
        element: { id: 'tbl-1', type: 'table', bind: 'x', columns: [{ id: '', header: 'A', path: 'a' }, { id: '', header: 'B', path: 'b' }] },
      }],
    };
    const problems = validateInserted(mergePreview(standard(), overlay));
    expect(problems).toEqual([
      { id: 'tbl-1.columns[0]', code: 'columnMalformed' },
      { id: 'tbl-1.columns[1]', code: 'columnMalformed' },
      // Accurate, not noise: neither column can be addressed, so the table has none.
      { id: 'tbl-1', code: 'tableMissingColumns' },
    ]);
    // The point of the test: no problem anchors to the empty id, and none is a duplicateId.
    expect(problems.every((p) => p.id !== '')).toBe(true);
    expect(problems.some((p) => p.code === 'duplicateId')).toBe(false);
  });

  it('validateInserted flags a duplicate column id anywhere in the document', () => {
    const doc: ReportDefinitionDoc = {
      schemaVersion: 1, key: 'k', version: '1',
      body: [
        { id: 't1', type: 'table', bind: 'a', columns: [{ id: 'dup', header: 'A', path: 'a' }] },
        { id: 't2', type: 'table', bind: 'b', columns: [{ id: 'dup', header: 'B', path: 'b' }] },
      ],
    };
    const problems = validateInserted(mergePreview(doc, null));
    expect(problems.some((p) => p.code === 'duplicateId' && p.id === 'dup')).toBe(true);
  });

  // Regression: validateInserted had no keyValueGrid case, never checked a table's per-column
  // path/template, and never flagged an unknown element type — validateDefinition (the
  // standard-authoring mirror) already checked all three, so overlay-inserted content could
  // silently save something direct authoring would reject.
  it('validateInserted shares content rules with validateDefinition: pair/column values and unknown types', () => {
    const overlay: ReportOverlayDoc = {
      insert: [
        { id: 'ins-1', anchor: BODY_PSEUDO_ANCHOR, position: 'appendInto', element: { id: 'grid-1', type: 'keyValueGrid', pairs: [{ id: 'gp-1', label: 'X' }] } },
        { id: 'ins-2', anchor: BODY_PSEUDO_ANCHOR, position: 'appendInto', element: { id: 'tbl-1', type: 'table', bind: 'x', columns: [{ id: 'tc-1', header: 'H' }] } },
        { id: 'ins-3', anchor: BODY_PSEUDO_ANCHOR, position: 'appendInto', element: { id: 'bogus-1', type: 'bogusType', text: 'x' } },
      ],
    };
    const problems = validateInserted(mergePreview(standard(), overlay));
    expect(problems.some((p) => p.code === 'pairMissingValue' && p.id === 'gp-1')).toBe(true);
    expect(problems.some((p) => p.code === 'columnMissingValue' && p.id === 'tc-1')).toBe(true);
    expect(problems.some((p) => p.code === 'unknownElementType' && p.id === 'bogus-1')).toBe(true);
  });

  // Regression (#12): the column/pair value checks sat behind `if (!meta.get(el.id)?.insertPatchId)
  // continue`, which gates on the OWNING element being an insert. But meta is keyed by each
  // inserted node's own id, so an item added to a published owner — the common customisation —
  // never had its value checked and saved clean with no path and no template.
  it('validateInserted flags a valueless column or pair inserted into a PUBLISHED owner', () => {
    const overlay: ReportOverlayDoc = {
      insert: [
        { id: 'ins-1', anchor: 'col-code', position: 'after', element: { id: 'col-new', header: 'New' } },
        { id: 'ins-2', anchor: 'kv-status', position: 'after', element: { id: 'kv-new', label: 'New' } },
      ],
    };
    const preview = mergePreview(standard(), overlay);
    // The owners themselves are published — only the items are inserts.
    expect(preview.meta.get('lines')?.insertPatchId).toBeUndefined();
    expect(preview.meta.get('summary')?.insertPatchId).toBeUndefined();
    expect(preview.meta.get('col-new')?.insertPatchId).toBe('ins-1');
    expect(preview.meta.get('kv-new')?.insertPatchId).toBe('ins-2');

    const problems = validateInserted(preview);
    expect(problems.some((p) => p.code === 'columnMissingValue' && p.id === 'col-new')).toBe(true);
    expect(problems.some((p) => p.code === 'pairMissingValue' && p.id === 'kv-new')).toBe(true);
  });

  it('validateInserted still flags a valueless column nested in a WHOLLY inserted table', () => {
    // The owner half of the gate is not redundant: an inserted table registers meta for the
    // table id alone, never for its nested column/pair ids, so gating purely per-item would
    // lose this direction.
    const overlay: ReportOverlayDoc = {
      insert: [
        { id: 'ins-1', anchor: BODY_PSEUDO_ANCHOR, position: 'appendInto', element: { id: 'tbl-1', type: 'table', bind: 'x', columns: [{ id: 'tc-1', header: 'H' }] } },
        { id: 'ins-2', anchor: BODY_PSEUDO_ANCHOR, position: 'appendInto', element: { id: 'grid-1', type: 'keyValueGrid', pairs: [{ id: 'gp-1', label: 'L' }] } },
      ],
    };
    const preview = mergePreview(standard(), overlay);
    expect(preview.meta.get('tc-1')?.insertPatchId).toBeUndefined();
    expect(preview.meta.get('gp-1')?.insertPatchId).toBeUndefined();

    const problems = validateInserted(preview);
    expect(problems.some((p) => p.code === 'columnMissingValue' && p.id === 'tc-1')).toBe(true);
    expect(problems.some((p) => p.code === 'pairMissingValue' && p.id === 'gp-1')).toBe(true);
  });

  it('validateInserted leaves published items alone and accepts an inserted item that has a value', () => {
    // A published definition may legitimately carry a column with neither path nor template
    // (that content is the definition's business, not the overlay's) — and an inserted item
    // that does supply a value is fine. Without both, the fix above would just flag everything.
    const doc = standard();
    const owner = <T>(id: string): T => {
      const hit = doc.body!.find((n) => n.id === id);
      if (!hit) throw new Error(`fixture no longer has '${id}'`);
      return hit as T;
    };
    owner<{ columns: { id: string; header: string; path?: string }[] }>('lines')
      .columns.push({ id: 'col-blank', header: 'Blank' });
    owner<{ pairs: { id: string; label: string; path?: string }[] }>('summary')
      .pairs.push({ id: 'kv-blank', label: 'Blank' });

    const overlay: ReportOverlayDoc = {
      insert: [
        { id: 'ins-1', anchor: 'col-code', position: 'after', element: { id: 'col-ok', header: 'OK', path: 'ok' } },
        { id: 'ins-2', anchor: 'kv-status', position: 'after', element: { id: 'kv-ok', label: 'OK', template: '{{ x }}' } },
      ],
    };
    const problems = validateInserted(mergePreview(doc, overlay));
    expect(problems.some((p) => p.code === 'columnMissingValue')).toBe(false);
    expect(problems.some((p) => p.code === 'pairMissingValue')).toBe(false);
  });

  // #34: an entry that is not an object with an id has no id to anchor a problem to. The old
  // code pushed `{ id: undefined }`, which renders as a blank heading in the problems popover,
  // and `registerId(undefined)` made every later id-less entry collide into a phantom
  // duplicateId. Report it against the owner instead, positionally.
  it('validateInserted anchors a malformed inserted column or pair to its owner', () => {
    const overlay: ReportOverlayDoc = {
      insert: [
        { id: 'ins-1', anchor: BODY_PSEUDO_ANCHOR, position: 'appendInto', element: { id: 'tbl-1', type: 'table', bind: 'x', columns: ['a', 'b'] } },
        { id: 'ins-2', anchor: BODY_PSEUDO_ANCHOR, position: 'appendInto', element: { id: 'grid-1', type: 'keyValueGrid', pairs: [null, { id: 'gp-ok', label: 'L', path: 'p' }] } },
      ],
    };
    const problems = validateInserted(mergePreview(standard(), overlay));

    expect(problems).toContainEqual({ id: 'tbl-1.columns[0]', code: 'columnMalformed' });
    expect(problems).toContainEqual({ id: 'tbl-1.columns[1]', code: 'columnMalformed' });
    expect(problems).toContainEqual({ id: 'grid-1.pairs[0]', code: 'pairMalformed' });

    // Every problem carries a usable anchor, and no phantom duplicate is invented for the
    // second id-less entry.
    expect(problems.every((p) => typeof p.id === 'string' && p.id.length > 0)).toBe(true);
    expect(problems.some((p) => p.code === 'duplicateId')).toBe(false);
    // The one well-formed pair still validates on its own id, not positionally.
    expect(problems.some((p) => p.id === 'gp-ok')).toBe(false);
  });

  it('validateInserted reports a columns/pairs field that is not a list at all', () => {
    const overlay: ReportOverlayDoc = {
      insert: [
        { id: 'ins-1', anchor: BODY_PSEUDO_ANCHOR, position: 'appendInto', element: { id: 'tbl-1', type: 'table', bind: 'x', columns: {} } },
        { id: 'ins-2', anchor: BODY_PSEUDO_ANCHOR, position: 'appendInto', element: { id: 'grid-1', type: 'keyValueGrid', pairs: 3 } },
      ],
    };
    const problems = validateInserted(mergePreview(standard(), overlay));
    expect(problems).toContainEqual({ id: 'tbl-1.columns', code: 'columnMalformed' });
    expect(problems).toContainEqual({ id: 'grid-1.pairs', code: 'pairMalformed' });
    // A table whose columns cannot be read has no columns either — both are true and the two
    // problems carry different anchors, so neither hides the other.
    expect(problems).toContainEqual({ id: 'tbl-1', code: 'tableMissingColumns' });
  });

  it('validateInserted leaves a published owner\'s malformed items alone', () => {
    // Same rule as #12: content inside a published owner belongs to the definition, not the
    // overlay — and with no id there is no way to ask whether the item itself was inserted.
    const doc = standard();
    const lines = doc.body!.find((n) => n.id === 'lines') as { columns: unknown[] };
    lines.columns.push('junk');

    const problems = validateInserted(mergePreview(doc, emptyOverlay()));
    expect(problems.some((p) => p.code === 'columnMalformed')).toBe(false);
    expect(problems).toEqual([]);
  });

  it('validateInserted reports, rather than throws, on an insert payload with no columns or pairs', () => {
    // `insert.element` is arbitrary host JSON — mergePreview only requires an id, and precise
    // per-target payload validation is the server's job. A table payload with no `columns` at
    // all used to reach the id-registration walk and die on `for (const c of el.columns)`,
    // so a save-time validator threw where it owed the host a problem list.
    const overlay: ReportOverlayDoc = {
      insert: [
        { id: 'ins-1', anchor: BODY_PSEUDO_ANCHOR, position: 'appendInto', element: { id: 'tbl-1', type: 'table', bind: 'x' } },
        { id: 'ins-2', anchor: BODY_PSEUDO_ANCHOR, position: 'appendInto', element: { id: 'grid-1', type: 'keyValueGrid' } },
      ],
    };
    const problems = validateInserted(mergePreview(standard(), overlay));
    expect(problems.some((p) => p.code === 'tableMissingColumns' && p.id === 'tbl-1')).toBe(true);
    expect(problems.some((p) => p.id === 'grid-1')).toBe(false);
  });
});

describe('overlayModel — op compilation', () => {
  it('setElementProp writes one setProps entry; default-elision removes it again', () => {
    const meta = mergePreview(standard(), emptyOverlay()).meta;
    let overlay = setElementProp(emptyOverlay(), meta, 'detail-text', 'style.fontSize', 14, 9);
    expect(overlay.setProps).toEqual([{ id: 'detail-text', props: { 'style.fontSize': 14 } }]);

    overlay = setElementProp(overlay, meta, 'detail-text', 'text', 'Custom', undefined);
    expect(overlay.setProps![0]!.props).toEqual({ 'style.fontSize': 14, text: 'Custom' });

    // Back to default → key removed; last key removed → entry gone.
    overlay = setElementProp(overlay, meta, 'detail-text', 'text', undefined, undefined);
    expect(overlay.setProps![0]!.props).toEqual({ 'style.fontSize': 14 });
    overlay = setElementProp(overlay, meta, 'detail-text', 'style.fontSize', 9, 9);
    expect(overlay.setProps).toBeUndefined();
    expect(isOverlayEmpty(overlay)).toBe(true);
  });

  it('resetElementProp clears an override', () => {
    const meta = mergePreview(standard(), emptyOverlay()).meta;
    let overlay = setElementProp(emptyOverlay(), meta, 'detail-text', 'align', 'right', 'left');
    overlay = resetElementProp(overlay, meta, 'detail-text', 'align');
    expect(overlay.setProps).toBeUndefined();
  });

  it('edits to overlay-inserted elements mutate the insert payload, never setProps', () => {
    let overlay = insertElement(emptyOverlay(), collectAllIds(standard(), emptyOverlay()),
      { id: 'txt-9', type: 'text', text: 'Hello' }, BODY_PSEUDO_ANCHOR, 'appendInto');
    const meta = mergePreview(standard(), overlay).meta;

    overlay = setElementProp(overlay, meta, 'txt-9', 'text', 'Edited', undefined);
    expect(overlay.setProps).toBeUndefined();
    expect(overlay.insert![0]!.element.text).toBe('Edited');

    overlay = setElementProp(overlay, meta, 'txt-9', 'style.bold', true, false);
    expect((overlay.insert![0]!.element.style as { bold: boolean }).bold).toBe(true);
    // Elision inside the payload too: bold back to default removes style entirely.
    overlay = setElementProp(overlay, meta, 'txt-9', 'style.bold', false, false);
    expect(overlay.insert![0]!.element.style).toBeUndefined();
  });

  it('suppress ghosts standard elements; deleting a tenant insert removes the op instead', () => {
    let overlay = suppressElement(emptyOverlay(), new Map(), 'detail-text');
    expect(overlay.suppress).toEqual(['detail-text']);
    overlay = suppressElement(overlay, new Map(), 'detail-text');
    expect(overlay.suppress).toEqual(['detail-text']); // dedup

    // Anchor via $body, not the suppressed 'detail-text': an insert whose anchor is
    // suppressed no longer places (server-parity), so it would carry no insert meta.
    overlay = insertElement(overlay, collectAllIds(standard(), overlay),
      { id: 'txt-9', type: 'text', text: 'Hello' }, BODY_PSEUDO_ANCHOR, 'appendInto');
    const meta = mergePreview(standard(), overlay).meta;
    overlay = suppressElement(overlay, meta, 'txt-9');
    expect(overlay.insert).toBeUndefined();
    expect(overlay.suppress).toEqual(['detail-text']);

    overlay = restoreElement(overlay, 'detail-text');
    expect(overlay.suppress).toBeUndefined();
  });

  it('nextId never regenerates or collides, even after deletions', () => {
    const taken = new Set(['txt-1', 'txt-3', 'ins-2']);
    expect(nextId('txt', taken)).toBe('txt-4');
    expect(nextId('ins', taken)).toBe('ins-3');
    expect(nextId('tbl', taken)).toBe('tbl-1');
  });

  // Regression: collectAllIds used to harvest only an insert's top-level id plus one level of
  // columns/pairs, never recursing into `children` — so a nested child id (like collectSubtreeIds
  // finds) was invisible to nextId's collision check, and a second insert could mint a duplicate.
  it('collectAllIds sees ids nested inside a pending insert\'s children, not just its top level', () => {
    const overlay: ReportOverlayDoc = {
      insert: [{
        id: 'ins-1', anchor: BODY_PSEUDO_ANCHOR, position: 'appendInto',
        element: { id: 'row-1', type: 'row', children: [{ id: 'txt-5', type: 'text', text: 'x' }] },
      }],
    };
    const ids = collectAllIds(standard(), overlay);
    expect(ids.has('txt-5')).toBe(true);
    expect(nextId('txt', ids)).not.toBe('txt-5');
  });

  it('serializeOverlay emits only allowlisted top-level keys in stable order', () => {
    const overlay: ReportOverlayDoc = { schemaVersion: 1, reportKey: 'test-report', baseVersion: '1.2.0', suppress: ['a'] };
    const parsed = JSON.parse(serializeOverlay(overlay)) as Record<string, unknown>;
    // Guard (per the #2145 schemaVersion regression): nothing outside the server's
    // case-sensitive allowlist may ever appear in the document we PUT.
    expect(Object.keys(parsed).every((k) =>
      ['suppress', 'insert', 'setProps', 'schemaVersion', 'baseVersion', 'reportKey'].includes(k))).toBe(true);
    expect(parsed.suppress).toEqual(['a']);
  });
});
