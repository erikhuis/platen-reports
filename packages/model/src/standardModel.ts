/**
 * Direct authoring of a definition document, as opposed to patching one with an overlay.
 *
 * Every helper is pure: deep-clone in, new document out. `serializeDefinition` writes the JSON
 * an author publishes; `validateDefinition` mirrors the engine parser's fatal rules so the
 * author sees the problems before publishing rather than after.
 */

import {
  childElements, ELEMENT_DEFAULTS, walkElements,
  type ReportDefinitionDoc, type ReportElementNode,
} from './designerModel';
import { BODY_PSEUDO_ANCHOR, type OverlayProblem } from './overlayModel';
import type { InsertTarget } from './designerEditing';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

interface AnyNode { id: string; type?: string; children?: AnyNode[]; columns?: AnyNode[]; pairs?: AnyNode[]; [k: string]: unknown }

/** The array + index that holds `id`, plus a setter to replace the array (for reorder). */
interface Located {
  array: AnyNode[];
  index: number;
  /** Owner element ('body'/'header'/'footer' pseudo, or an element id). */
  parentId: string;
}

/** Locate an element/column/pair id and the sibling array it lives in. */
function locate(doc: ReportDefinitionDoc, id: string): Located | null {
  const search = (array: AnyNode[] | undefined, parentId: string): Located | null => {
    // keyValueGrid.columns is a NUMBER (column count), so searchNode's node.columns
    // is not always an array — reject any non-array before findIndex/iteration.
    if (!Array.isArray(array)) return null;
    const index = array.findIndex((n) => n.id === id);
    if (index >= 0) return { array, index, parentId };
    for (const node of array) {
      const nested = searchNode(node);
      if (nested) return nested;
    }
    return null;
  };
  const searchNode = (node: AnyNode): Located | null =>
    search(node.children, node.id) ?? search(node.columns, node.id) ?? search(node.pairs, node.id);

  const d = doc as unknown as { pageHeader?: AnyNode; body?: AnyNode[]; pageFooter?: AnyNode };
  if (d.pageHeader) {
    if (d.pageHeader.id === id) return { array: [d.pageHeader], index: 0, parentId: 'header' };
    const hit = searchNode(d.pageHeader);
    if (hit) return hit;
  }
  const inBody = search(d.body, 'body');
  if (inBody) return inBody;
  if (d.pageFooter) {
    if (d.pageFooter.id === id) return { array: [d.pageFooter], index: 0, parentId: 'footer' };
    const hit = searchNode(d.pageFooter);
    if (hit) return hit;
  }
  return null;
}

/** The sibling array identified by a parent id ('body'/'header'/'footer' or an element id). */
function siblingArray(doc: ReportDefinitionDoc, parentId: string): AnyNode[] | null {
  const d = doc as unknown as { pageHeader?: AnyNode; body?: AnyNode[]; pageFooter?: AnyNode };
  if (parentId === 'body') return (d.body ??= []);
  if (parentId === 'header') return d.pageHeader ? [d.pageHeader] : null;
  if (parentId === 'footer') return d.pageFooter ? [d.pageFooter] : null;
  for (const el of walkElements(doc)) {
    const n = el as unknown as AnyNode;
    if (n.id !== parentId) continue;
    if (n.children) return n.children;
    if (n.type === 'table') return (n.columns ??= []);
    if (n.type === 'keyValueGrid') return (n.pairs ??= []);
    if (n.type === 'row' || n.type === 'column' || n.type === 'container') return (n.children ??= []);
    return null;
  }
  return null;
}

/** Set a property on an element/column/pair, DROPPING it when equal to its default (elision). */
export function setNodeProp(
  doc: ReportDefinitionDoc, id: string, prop: string, value: unknown, defaultValue: unknown,
): ReportDefinitionDoc {
  const next = clone(doc);
  const hit = locate(next, id);
  if (!hit) return next;
  const node = hit.array[hit.index] as AnyNode;
  const isDefault = value === undefined || value === defaultValue || (value === '' && (defaultValue === '' || defaultValue === undefined));
  if (prop.startsWith('style.')) {
    const style = { ...((node.style as Record<string, unknown>) ?? {}) };
    if (isDefault) delete style[prop.slice(6)];
    else style[prop.slice(6)] = value;
    if (Object.keys(style).length === 0) delete node.style; else node.style = style;
  } else if (isDefault) {
    delete node[prop];
  } else {
    node[prop] = value;
  }
  return next;
}

/** Delete an element/column/pair outright. */
export function deleteNode(doc: ReportDefinitionDoc, id: string): ReportDefinitionDoc {
  const next = clone(doc);
  const d = next as unknown as { pageHeader?: AnyNode; pageFooter?: AnyNode };
  if (d.pageHeader?.id === id) { delete d.pageHeader; return next; }
  if (d.pageFooter?.id === id) { delete d.pageFooter; return next; }
  const hit = locate(next, id);
  if (hit) hit.array.splice(hit.index, 1);
  return next;
}

/** Insert an element relative to an anchor (reuses the shared InsertTarget shape). */
export function insertNode(
  doc: ReportDefinitionDoc, element: Record<string, unknown>, target: InsertTarget,
): ReportDefinitionDoc {
  const next = clone(doc);
  if (target.anchor === BODY_PSEUDO_ANCHOR) {
    // Mirrors overlayModel.ts's InsertInvalidPosition rejection: $body only supports
    // appendInto — there is no sibling to be "before"/"after" at the document root.
    if (target.position !== 'appendInto') return next;
    const body = ((next as unknown as { body?: AnyNode[] }).body ??= []);
    body.push(element as AnyNode);
    return next;
  }
  if (target.position === 'appendInto') {
    const arr = siblingArray(next, target.anchor);
    if (arr) arr.push(element as AnyNode);
    return next;
  }
  // before/after on a fixed-slot root (pageHeader/pageFooter) has no sibling array to splice
  // into — locate() wraps it in a throwaway array for property mutation, which a splice would
  // silently discard. Mirrors overlayModel.ts's InsertInvalidTarget rejection for the same case.
  const d = next as unknown as { pageHeader?: AnyNode; pageFooter?: AnyNode };
  if (target.anchor === d.pageHeader?.id || target.anchor === d.pageFooter?.id) return next;
  const hit = locate(next, target.anchor);
  if (hit) hit.array.splice(target.position === 'before' ? hit.index : hit.index + 1, 0, element as AnyNode);
  return next;
}

/** Reorder a sibling array in place (same-parent only). */
export function reorderSiblings(
  doc: ReportDefinitionDoc, parentId: string, fromIndex: number, toIndex: number,
): ReportDefinitionDoc {
  const next = clone(doc);
  const arr = siblingArray(next, parentId);
  if (!arr || fromIndex === toIndex) return next;
  if (fromIndex < 0 || fromIndex >= arr.length || toIndex < 0 || toIndex >= arr.length) return next;
  // Bounds were checked above, so the splice always yields exactly one element.
  const [moved] = arr.splice(fromIndex, 1);
  arr.splice(toIndex, 0, moved!);
  return next;
}

/** The section ('header'/'body'/'footer') that owns an id — drives the pageNumber palette lock. */
export function sectionOf(doc: ReportDefinitionDoc, id: string): 'header' | 'body' | 'footer' {
  const d = doc as unknown as { pageHeader?: ReportElementNode; pageFooter?: ReportElementNode };
  const inTree = (root: ReportElementNode | undefined) =>
    root ? [...walkOne(root)].some((n) => n.id === id) : false;
  if (inTree(d.pageHeader)) return 'header';
  if (inTree(d.pageFooter)) return 'footer';
  return 'body';
}
function* walkOne(node: ReportElementNode): Generator<ReportElementNode> {
  yield node;
  for (const child of childElements(node)) yield* walkOne(child);
}

/**
 * Client mirror of ReportDefinitionParser's fatal rules over the WHOLE document (every
 * element is editable in standard mode). The parser + StandardDefinitionsTests remain the
 * authoritative gate when the exported file lands in the repo.
 */
export function validateDefinition(doc: ReportDefinitionDoc): OverlayProblem[] {
  const problems: OverlayProblem[] = [];
  const seen = new Set<string>();
  const known = new Set(['text', 'field', 'row', 'column', 'container', 'table', 'keyValueGrid', 'spacer', 'line', 'image', 'pageNumber']);

  // Doc-level required fields — all editable in standard mode (Report settings), so mirror the
  // parser's "'x' is required" rules here or Export would ship a file the server rejects.
  const meta = doc as unknown as { key?: string; version?: string; dataSource?: string; parameters?: { name?: string }[] };
  if (!meta.key?.trim()) problems.push({ id: '$document', code: 'documentMissingKey' });
  if (!meta.version?.trim()) problems.push({ id: '$document', code: 'documentMissingVersion' });
  if (!meta.dataSource?.trim()) problems.push({ id: '$document', code: 'documentMissingDataSource' });
  (meta.parameters ?? []).forEach((p, i) => {
    if (!p.name?.trim()) problems.push({ id: `parameters[${i}]`, code: 'parameterMissingName', values: { index: String(i + 1) } });
  });

  for (const el of walkElements(doc)) {
    if (!el.id) { problems.push({ id: '?', code: 'elementMissingId' }); continue; }
    if (seen.has(el.id)) problems.push({ id: el.id, code: 'duplicateId', values: { id: el.id } });
    seen.add(el.id);
    // Columns / pairs need a path or template.
    if (el.type === 'table') {
      for (const c of el.columns ?? []) {
        if (seen.has(c.id)) problems.push({ id: c.id, code: 'duplicateId', values: { id: c.id } });
        seen.add(c.id);
        if (!c.path && !c.template) problems.push({ id: c.id, code: 'columnMissingValue' });
      }
    }
    if (el.type === 'keyValueGrid') {
      for (const p of el.pairs ?? []) {
        if (seen.has(p.id)) problems.push({ id: p.id, code: 'duplicateId', values: { id: p.id } });
        seen.add(p.id);
        if (!p.path && !p.template) problems.push({ id: p.id, code: 'pairMissingValue' });
      }
    }
    if (!known.has(el.type)) { problems.push({ id: el.id, code: 'unknownElementType', values: { type: el.type } }); continue; }
    switch (el.type) {
      case 'text':
        if (!el.text || (typeof el.text === 'string' && el.text.trim() === '')) problems.push({ id: el.id, code: 'textElementEmpty' });
        break;
      case 'field':
        if (!el.path) problems.push({ id: el.id, code: 'fieldMissingPath' });
        break;
      case 'table':
        if (!el.bind) problems.push({ id: el.id, code: 'tableMissingBind' });
        else if (!el.columns?.length) problems.push({ id: el.id, code: 'tableMissingColumns' });
        break;
      case 'image':
        if ((el.source ?? 'tenantLogo') !== 'tenantLogo') problems.push({ id: el.id, code: 'unsupportedImageSource' });
        break;
      case 'pageNumber':
        if (sectionOf(doc, el.id) === 'body') problems.push({ id: el.id, code: 'pageNumberInBody' });
        break;
      case 'container':
        if (el.width !== undefined && el.width !== 'full' && el.width !== 'half' && typeof el.width !== 'number') {
          problems.push({ id: el.id, code: 'invalidContainerWidth' });
        }
        break;
      default:
        break;
    }
  }
  return problems;
}

/**
 * Export JSON: default-elision so defaults are never written (a clean, minimal definition).
 * Edits already elide via `setNodeProp`; this pass also strips any default-equal props that
 * were present in the source, keeping the committed file tidy.
 */
export function serializeDefinition(doc: ReportDefinitionDoc): string {
  const stripped = clone(doc) as unknown as AnyNode;
  // ELEMENT_DEFAULTS is typed as an open Record, so indexing it widens to `| undefined`
  // even for a key that is always present.
  const styleDefaults = ELEMENT_DEFAULTS.style!;
  // `defaultsKey` lets callers pass the ELEMENT_DEFAULTS key explicitly for nodes with no
  // `type` discriminant of their own (table columns, keyValueGrid pairs) — indexing by
  // `node.type` for those is always `undefined`, silently skipping their default-elision.
  const stripNode = (node: AnyNode, defaultsKey?: string) => {
    const typeDefaults = ELEMENT_DEFAULTS[defaultsKey ?? node.type ?? ''];
    if (typeDefaults) {
      for (const [k, v] of Object.entries(typeDefaults)) {
        if (node[k] !== undefined && node[k] === v) delete node[k];
      }
    }
    if (node.style && typeof node.style === 'object') {
      const style = node.style as Record<string, unknown>;
      for (const [k, v] of Object.entries(styleDefaults)) {
        if (style[k] !== undefined && style[k] === v) delete style[k];
      }
      if (Object.keys(style).length === 0) delete node.style;
    }
    for (const child of node.children ?? []) stripNode(child);
    // keyValueGrid.columns is a NUMBER (column count), not a table's column array —
    // only descend when it is genuinely an array of column elements.
    if (Array.isArray(node.columns)) for (const col of node.columns) stripNode(col);
    for (const pair of node.pairs ?? []) stripNode(pair, 'pair');
  };
  const d = stripped as { pageHeader?: AnyNode; body?: AnyNode[]; pageFooter?: AnyNode };
  if (d.pageHeader) stripNode(d.pageHeader);
  for (const n of d.body ?? []) stripNode(n);
  if (d.pageFooter) stripNode(d.pageFooter);
  return JSON.stringify(stripped, null, 2);
}
