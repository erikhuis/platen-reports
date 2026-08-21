/**
 * Client-side customisation-overlay editing.
 *
 * Every designer gesture compiles to the three overlay operations the engine merges at render
 * time: `suppress`, `insert`, `setProps`. This module mirrors those semantics — apply order
 * suppress → insert → setProps, the setProps allowlist, the warning codes, the `$body`
 * pseudo-anchor — as a **preview**. The authoritative merge and validation stay with the
 * engine; the conformance suite is what keeps the two implementations honest.
 *
 * One deliberate difference from the engine: where the engine removes suppressed nodes, the
 * preview KEEPS them and marks them in a side-channel meta map, so a UI can ghost them. That
 * meta never leaks into any JSON a caller sees.
 */

import {
  childElements, KNOWN_ELEMENT_TYPES, walkElements,
  type KeyValuePairNode, type ReportDefinitionDoc, type ReportElementNode, type TableColumnNode,
} from './designerModel';

/** Mirror of OverlayMergeWarningCode (ReportOverlayModel.cs). */
export type OverlayWarningCode =
  | 'SuppressedIdNotFound'
  | 'InsertAnchorNotFound'
  | 'InsertInvalidPosition'
  | 'InsertInvalidTarget'
  | 'InsertIdCollision'
  | 'InsertInvalidElement'
  | 'SetPropsIdNotFound'
  | 'SetPropsDisallowedProp'
  | 'BaseVersionOutdated'
  | 'SuppressBlocked';

export interface OverlayWarning {
  code: OverlayWarningCode;
  targetId?: string;
  detail: string;
}

/**
 * Machine codes for fatal validation problems. The model never emits translation
 * keys — a host maps these to its own wording, and they are a **public contract** once
 * Platen Reports ships: they appear in conformance fixtures, so renaming one is a breaking
 * change. Grouped by what is wrong, not by which validator raised it — `validateInserted`
 * (overlay inserts) and `validateDefinition` (direct authoring) share the vocabulary.
 */
export type OverlayProblemCode =
  // Document metadata (standard authoring only).
  | 'documentMissingKey'
  | 'documentMissingVersion'
  | 'documentMissingDataSource'
  | 'parameterMissingName'
  // Identity.
  | 'elementMissingId'
  | 'duplicateId'
  | 'unknownElementType'
  // Per-type content requirements.
  | 'textElementEmpty'
  | 'fieldMissingPath'
  | 'tableMissingBind'
  | 'tableMissingColumns'
  | 'columnMissingValue'
  | 'pairMissingValue'
  | 'unsupportedImageSource'
  // Placement / layout.
  | 'pageNumberInBody'
  | 'invalidContainerWidth';

/** A fatal save-time problem on an overlay-inserted element. */
export interface OverlayProblem {
  id: string;
  code: OverlayProblemCode;
  /** Interpolation values the host substitutes into its message. */
  values?: Record<string, string>;
}

export interface OverlayInsertOp {
  /** The patch's own id (stable, `ins-NNN`). */
  id: string;
  anchor: string;
  position: 'before' | 'after' | 'appendInto';
  element: Record<string, unknown>;
}

export interface OverlaySetPropsOp {
  id: string;
  props: Record<string, unknown>;
}

export interface ReportOverlayDoc {
  schemaVersion?: number;
  reportKey?: string;
  baseVersion?: string;
  suppress?: string[];
  insert?: OverlayInsertOp[];
  setProps?: OverlaySetPropsOp[];
}

/** The server's `$body` pseudo-anchor (ReportOverlayMerger.BodyPseudoAnchor). */
export const BODY_PSEUDO_ANCHOR = '$body';

/** Mirror of ReportOverlayMerger.SetPropsAllowedRoots (`style.*` leaves also allowed). */
export const SET_PROPS_ALLOWED_ROOTS = new Set([
  'text', 'template', 'format', 'emptyText', 'visibleIf', 'header', 'label', 'title',
  'height', 'thickness', 'weight', 'width', 'align', 'spacing', 'color', 'groupBy',
  'repeatHeader', 'markdown',
]);

export function isAllowedSetProp(prop: string): boolean {
  return prop.startsWith('style.') || SET_PROPS_ALLOWED_ROOTS.has(prop);
}

/** Per-id annotations for the DISPLAYED (ghost-preserving) merge preview. */
export interface OverlayNodeMeta {
  suppressed?: boolean;
  /** Set when the node came from an insert op; value = the patch id. */
  insertPatchId?: string;
  /** Props overridden via setProps for this id (drives override dots + reset). */
  touchedProps?: Set<string>;
}

export interface MergePreview {
  /** Merged doc with suppressed nodes KEPT (for ghosting) — never serialized. */
  displayDoc: ReportDefinitionDoc;
  /** Merged doc with suppressed nodes removed — matches the server's effective JSON. */
  effectiveDoc: ReportDefinitionDoc;
  meta: Map<string, OverlayNodeMeta>;
  warnings: OverlayWarning[];
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function metaFor(meta: Map<string, OverlayNodeMeta>, id: string): OverlayNodeMeta {
  let m = meta.get(id);
  if (!m) { m = {}; meta.set(id, m); }
  return m;
}

interface AnyNode { id: string; [key: string]: unknown }

/** Every id in the doc: elements, table columns, kv pairs. */
export function collectDocIds(doc: ReportDefinitionDoc): Set<string> {
  const ids = new Set<string>();
  for (const el of walkElements(doc)) {
    ids.add(el.id);
    if (el.type === 'table') for (const c of el.columns ?? []) ids.add(c.id);
    if (el.type === 'keyValueGrid') for (const p of el.pairs ?? []) ids.add(p.id);
  }
  return ids;
}

/** All ids the overlay itself introduces or references (for collision checks). */
export function collectAllIds(doc: ReportDefinitionDoc, overlay: ReportOverlayDoc): Set<string> {
  const ids = collectDocIds(doc);
  for (const s of overlay.suppress ?? []) ids.add(s);
  for (const ins of overlay.insert ?? []) {
    ids.add(ins.id);
    // Full subtree scan — a pending insert's nested children/columns/pairs are ids too, and
    // nextId must never re-mint one of them (collectSubtreeIds is the one place this recursion
    // is defined; re-deriving a shallow copy here previously missed nested `children`).
    for (const id of collectSubtreeIds(ins.element)) ids.add(id);
  }
  return ids;
}

/**
 * Every id an inserted element subtree declares — the element id, nested child element
 * ids (recursively), table column ids and keyValueGrid pair ids. Mirrors the server's
 * `ReportDefinitionParser.ValidateElementSubtree` id scan so a collision on ANY id in
 * the payload (not just the top-level one) skips the whole insert.
 */
export function collectSubtreeIds(element: Record<string, unknown>): string[] {
  const ids: string[] = [];
  const visit = (node: AnyNode | undefined) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.id === 'string') ids.push(node.id);
    for (const child of (node.children as AnyNode[] | undefined) ?? []) visit(child);
    for (const c of (node.columns as AnyNode[] | undefined) ?? []) visit(c);
    for (const p of (node.pairs as AnyNode[] | undefined) ?? []) visit(p);
  };
  visit(element as AnyNode);
  return ids;
}

/** `prefix-NNN`, collision-checked against every known id; NNN grows monotonically. */
export function nextId(prefix: string, taken: Set<string>): string {
  let n = 1;
  // Start past any existing same-prefix numeric suffix so ids never collide even
  // after deletions (ids are a stable public contract — never regenerated).
  for (const id of taken) {
    const match = id.match(new RegExp(`^${prefix}-(\\d+)$`));
    if (match) n = Math.max(n, Number(match[1]) + 1);
  }
  let candidate = `${prefix}-${n}`;
  while (taken.has(candidate)) candidate = `${prefix}-${++n}`;
  return candidate;
}

// ─── Merge preview (suppress → insert → setProps) ────────────────────────────

function findAnywhere(doc: ReportDefinitionDoc, id: string):
  | { kind: 'element'; node: ReportElementNode }
  | { kind: 'column'; owner: ReportElementNode; node: TableColumnNode }
  | { kind: 'pair'; owner: ReportElementNode; node: KeyValuePairNode }
  | null {
  for (const el of walkElements(doc)) {
    if (el.id === id) return { kind: 'element', node: el };
    if (el.type === 'table') {
      const c = el.columns?.find((x) => x.id === id);
      if (c) return { kind: 'column', owner: el, node: c };
    }
    if (el.type === 'keyValueGrid') {
      const p = el.pairs?.find((x) => x.id === id);
      if (p) return { kind: 'pair', owner: el, node: p };
    }
  }
  return null;
}

function insertIntoSequence(
  doc: ReportDefinitionDoc, op: OverlayInsertOp, warnings: OverlayWarning[], suppressed: Set<string>,
): boolean {
  const element = op.element as unknown as ReportElementNode;
  if (op.anchor === BODY_PSEUDO_ANCHOR) {
    if (op.position !== 'appendInto') {
      warnings.push({ code: 'InsertInvalidPosition', targetId: op.id, detail: `insert '${op.id}': $body only supports appendInto.` });
      return false;
    }
    doc.body = [...(doc.body ?? []), element];
    return true;
  }

  // The server removes suppressed nodes BEFORE applying inserts (suppress → insert order),
  // so an anchor that the overlay also suppresses reads as "not found" at merge time —
  // even though displayDoc keeps it for ghosting. ($body is never suppressed.)
  if (suppressed.has(op.anchor)) {
    warnings.push({ code: 'InsertAnchorNotFound', targetId: op.anchor, detail: `insert '${op.id}': anchor '${op.anchor}' not found.` });
    return false;
  }

  const hit = findAnywhere(doc, op.anchor);
  if (!hit) {
    warnings.push({ code: 'InsertAnchorNotFound', targetId: op.anchor, detail: `insert '${op.id}': anchor '${op.anchor}' not found.` });
    return false;
  }

  if (op.position === 'appendInto') {
    // Server ApplyInserts: appendInto requires a row/column/container; children is created
    // when absent, so an empty (children-less) container is still a valid target.
    const type = hit.kind === 'element' ? hit.node.type : undefined;
    if (type !== 'row' && type !== 'column' && type !== 'container') {
      warnings.push({ code: 'InsertInvalidTarget', targetId: op.anchor, detail: `insert '${op.id}': '${op.anchor}' cannot contain children.` });
      return false;
    }
    const parent = hit.node as { children?: ReportElementNode[] };
    parent.children = [...(parent.children ?? []), element];
    return true;
  }

  // before/after on a fixed-slot root (pageHeader/pageFooter top element) lives in no
  // sibling array — the server returns InsertInvalidTarget, not InsertInvalidPosition.
  if (hit.kind === 'element' && (op.anchor === doc.pageHeader?.id || op.anchor === doc.pageFooter?.id)) {
    warnings.push({ code: 'InsertInvalidTarget', targetId: op.anchor, detail: `insert '${op.id}': '${op.anchor}' is a fixed slot and does not support before/after.` });
    return false;
  }

  // before/after — splice into whichever sibling array holds the anchor.
  const spliceInto = <T extends { id: string }>(arr: T[] | undefined, item: T): T[] | null => {
    if (!arr) return null;
    const at = arr.findIndex((x) => x.id === op.anchor);
    if (at < 0) return null;
    const next = [...arr];
    next.splice(op.position === 'before' ? at : at + 1, 0, item);
    return next;
  };

  if (hit.kind === 'column') {
    const next = spliceInto(hit.owner.type === 'table' ? hit.owner.columns : undefined, op.element as unknown as TableColumnNode);
    if (next && hit.owner.type === 'table') { hit.owner.columns = next; return true; }
  } else if (hit.kind === 'pair') {
    const next = spliceInto(hit.owner.type === 'keyValueGrid' ? hit.owner.pairs : undefined, op.element as unknown as KeyValuePairNode);
    if (next && hit.owner.type === 'keyValueGrid') { hit.owner.pairs = next; return true; }
  } else {
    // Element anchor: search body + every children array.
    const body = spliceInto(doc.body, element);
    if (body) { doc.body = body; return true; }
    for (const el of walkElements(doc)) {
      const children = childElements(el);
      if (children.length === 0 && !('children' in el)) continue;
      const next = spliceInto((el as { children?: ReportElementNode[] }).children, element);
      if (next) { (el as { children: ReportElementNode[] }).children = next; return true; }
    }
  }
  warnings.push({ code: 'InsertInvalidPosition', targetId: op.anchor, detail: `insert '${op.id}': could not place relative to '${op.anchor}'.` });
  return false;
}

/**
 * Client merge preview in server order. `displayDoc` keeps suppressed nodes (marked
 * in `meta`) so the UI can ghost them; `effectiveDoc` removes them like the server.
 */
export function mergePreview(standard: ReportDefinitionDoc, overlay: ReportOverlayDoc | null): MergePreview {
  const displayDoc = clone(standard);
  const meta = new Map<string, OverlayNodeMeta>();
  const warnings: OverlayWarning[] = [];
  if (!overlay) return { displayDoc, effectiveDoc: displayDoc, meta, warnings };

  if (overlay.baseVersion && standard.version && overlay.baseVersion !== standard.version) {
    warnings.push({
      code: 'BaseVersionOutdated',
      detail: `Overlay was authored against v${overlay.baseVersion}; the standard is v${standard.version}.`,
    });
  }

  // suppress — mark (display) and remember; blocked suppressions warn like the server.
  // The set of ACTUALLY-removed ids (not the blocked ones) drives the server-parity
  // "the node is gone" behavior in the insert/setProps phases below.
  const suppressedIds = new Set<string>();
  const docIds = collectDocIds(displayDoc);
  for (const id of overlay.suppress ?? []) {
    if (!docIds.has(id)) {
      warnings.push({ code: 'SuppressedIdNotFound', targetId: id, detail: `suppress: no element with id '${id}'.` });
      continue;
    }
    const hit = findAnywhere(displayDoc, id);
    if (hit && hit.kind !== 'element') {
      const owner = hit.owner;
      const list = hit.kind === 'column'
        ? (owner.type === 'table' ? owner.columns : [])
        : (owner.type === 'keyValueGrid' ? owner.pairs : []);
      const stillVisible = list.filter((x) => !meta.get(x.id)?.suppressed);
      const referenced = hit.kind === 'column' && owner.type === 'table'
        && [...(owner.totals ?? []), ...(owner.groupTotals ?? [])].some((t) => t.columnId === id);
      if (stillVisible.length <= 1 || referenced) {
        warnings.push({ code: 'SuppressBlocked', targetId: id, detail: `suppress: '${id}' cannot be removed (last item or referenced by totals).` });
        continue;
      }
    }
    metaFor(meta, id).suppressed = true;
    suppressedIds.add(id);
  }

  // insert — document order; collisions checked against the current display tree.
  // Only the payload id is strictly required here (columns/pairs carry no `type`);
  // precise per-target payload validation is the server's job.
  for (const op of overlay.insert ?? []) {
    const el = op.element as AnyNode | undefined;
    if (!el?.id) {
      warnings.push({ code: 'InsertInvalidElement', targetId: op.id, detail: `insert '${op.id}': element payload needs an id.` });
      continue;
    }
    // Collision must scan the ENTIRE subtree (nested children / columns / pairs), matching
    // the server's ValidateElementSubtree — a nested-id clash skips the whole insert.
    const existing = collectDocIds(displayDoc);
    const collision = collectSubtreeIds(el).find((subId) => existing.has(subId));
    if (collision) {
      warnings.push({ code: 'InsertIdCollision', targetId: collision, detail: `insert: id '${collision}' already exists.` });
      continue;
    }
    if (insertIntoSequence(displayDoc, clone(op), warnings, suppressedIds)) {
      metaFor(meta, el.id as string).insertPatchId = op.id;
    }
  }

  // setProps — last, so it can restyle inserts too.
  for (const op of overlay.setProps ?? []) {
    // A suppressed node was removed by the server before setProps runs — its overrides
    // can't apply. displayDoc keeps it (ghosted), so guard on the removed set explicitly.
    if (suppressedIds.has(op.id)) {
      warnings.push({ code: 'SetPropsIdNotFound', targetId: op.id, detail: `setProps: no element with id '${op.id}'.` });
      continue;
    }
    const hit = findAnywhere(displayDoc, op.id);
    if (!hit) {
      warnings.push({ code: 'SetPropsIdNotFound', targetId: op.id, detail: `setProps: no element with id '${op.id}'.` });
      continue;
    }
    const target = hit.node as unknown as Record<string, unknown>;
    const touched = (metaFor(meta, op.id).touchedProps ??= new Set<string>());
    for (const [prop, value] of Object.entries(op.props)) {
      if (!isAllowedSetProp(prop)) {
        warnings.push({ code: 'SetPropsDisallowedProp', targetId: op.id, detail: `setProps '${op.id}': '${prop}' is not overridable.` });
        continue;
      }
      touched.add(prop);
      if (prop.startsWith('style.')) {
        const style = { ...((target.style as Record<string, unknown>) ?? {}) };
        style[prop.slice(6)] = value;
        target.style = style;
      } else {
        target[prop] = value;
      }
    }
  }

  // effectiveDoc = display minus suppressed nodes (server behavior).
  const effectiveDoc = clone(displayDoc);
  const prune = (nodes: ReportElementNode[] | undefined): ReportElementNode[] | undefined =>
    nodes?.filter((n) => !meta.get(n.id)?.suppressed).map((n) => {
      const next = { ...n } as ReportElementNode;
      if ('children' in next) (next as { children?: ReportElementNode[] }).children = prune((next as { children?: ReportElementNode[] }).children) ?? [];
      if (next.type === 'table') next.columns = next.columns?.filter((c) => !meta.get(c.id)?.suppressed);
      if (next.type === 'keyValueGrid') next.pairs = next.pairs?.filter((p) => !meta.get(p.id)?.suppressed);
      return next;
    });
  effectiveDoc.body = prune(effectiveDoc.body) ?? [];
  if (effectiveDoc.pageHeader && meta.get(effectiveDoc.pageHeader.id)?.suppressed) delete effectiveDoc.pageHeader;
  else if (effectiveDoc.pageHeader) effectiveDoc.pageHeader = prune([effectiveDoc.pageHeader])![0];
  if (effectiveDoc.pageFooter && meta.get(effectiveDoc.pageFooter.id)?.suppressed) delete effectiveDoc.pageFooter;
  else if (effectiveDoc.pageFooter) effectiveDoc.pageFooter = prune([effectiveDoc.pageFooter])![0];

  return { displayDoc, effectiveDoc, meta, warnings };
}

// ─── Op compilation (pure; every function returns a NEW overlay) ─────────────

const emptyToUndefined = (overlay: ReportOverlayDoc): ReportOverlayDoc => {
  const next = { ...overlay };
  if (next.suppress?.length === 0) delete next.suppress;
  if (next.insert?.length === 0) delete next.insert;
  if (next.setProps?.length === 0) delete next.setProps;
  return next;
};

/** Values that count as "unset" for default-elision purposes. */
const equalsDefault = (value: unknown, defaultValue: unknown): boolean =>
  value === undefined
  || value === defaultValue
  || (value === '' && (defaultValue === '' || defaultValue === undefined));

/**
 * Compile a property edit. Overlay-inserted elements mutate their insert payload
 * directly (never setProps); standard elements get a setProps entry with
 * DEFAULT-ELISION — a value equal to its default removes the entry (defaults are
 * never written), and an emptied entry disappears entirely.
 */
export function setElementProp(
  overlay: ReportOverlayDoc,
  meta: Map<string, OverlayNodeMeta>,
  id: string,
  prop: string,
  value: unknown,
  defaultValue: unknown,
): ReportOverlayDoc {
  const insertPatchId = meta.get(id)?.insertPatchId;
  if (insertPatchId) {
    const insert = (overlay.insert ?? []).map((op) => {
      if (op.id !== insertPatchId) return op;
      const findTarget = (el: AnyNode): AnyNode | null => {
        if (el.id === id) return el;
        for (const child of (el.children as AnyNode[] | undefined) ?? []) {
          const hit = findTarget(child);
          if (hit) return hit;
        }
        for (const c of (el.columns as AnyNode[] | undefined) ?? []) if (c.id === id) return c;
        for (const p of (el.pairs as AnyNode[] | undefined) ?? []) if (p.id === id) return p;
        return null;
      };
      const element = clone(op.element) as AnyNode;
      const target = findTarget(element);
      if (!target) return op;
      if (prop.startsWith('style.')) {
        const style = { ...((target.style as Record<string, unknown>) ?? {}) };
        if (equalsDefault(value, defaultValue)) delete style[prop.slice(6)];
        else style[prop.slice(6)] = value;
        if (Object.keys(style).length === 0) delete target.style; else target.style = style;
      } else if (equalsDefault(value, defaultValue)) {
        delete target[prop];
      } else {
        target[prop] = value;
      }
      return { ...op, element };
    });
    return { ...overlay, insert };
  }

  const ops = [...(overlay.setProps ?? [])];
  const at = ops.findIndex((op) => op.id === id);
  // `at >= 0` already proves the element exists; the compiler cannot see it.
  const props = { ...(at >= 0 ? ops[at]!.props : {}) };
  if (equalsDefault(value, defaultValue)) delete props[prop];
  else props[prop] = value;

  if (Object.keys(props).length === 0) {
    if (at >= 0) ops.splice(at, 1);
  } else if (at >= 0) {
    ops[at] = { id, props };
  } else {
    ops.push({ id, props });
  }
  return emptyToUndefined({ ...overlay, setProps: ops });
}

/** Explicit reset: drop the prop's override (and the entry when emptied). */
export function resetElementProp(
  overlay: ReportOverlayDoc,
  meta: Map<string, OverlayNodeMeta>,
  id: string,
  prop: string,
): ReportOverlayDoc {
  return setElementProp(overlay, meta, id, prop, undefined, undefined);
}

/** Delete gesture: suppress a published element, or remove an overlay insert entirely. */
export function suppressElement(
  overlay: ReportOverlayDoc,
  meta: Map<string, OverlayNodeMeta>,
  id: string,
): ReportOverlayDoc {
  const insertPatchId = meta.get(id)?.insertPatchId;
  if (insertPatchId) {
    return emptyToUndefined({
      ...overlay,
      insert: (overlay.insert ?? []).filter((op) => op.id !== insertPatchId),
      // A removed insert leaves no orphan setProps behind (edits to inserts mutate
      // the payload), but clean up defensively in case of hand-edited overlays.
      setProps: (overlay.setProps ?? []).filter((op) => op.id !== id),
    });
  }
  const suppress = overlay.suppress ?? [];
  if (suppress.includes(id)) return overlay;
  return { ...overlay, suppress: [...suppress, id] };
}

/** Restore a suppressed element: remove its suppress op. */
export function restoreElement(overlay: ReportOverlayDoc, id: string): ReportOverlayDoc {
  return emptyToUndefined({
    ...overlay,
    suppress: (overlay.suppress ?? []).filter((s) => s !== id),
  });
}

/** Add gesture: a new insert op with a stable patch id. */
export function insertElement(
  overlay: ReportOverlayDoc,
  allIds: Set<string>,
  element: Record<string, unknown>,
  anchor: string,
  position: OverlayInsertOp['position'],
): ReportOverlayDoc {
  const op: OverlayInsertOp = { id: nextId('ins', allIds), anchor, position, element };
  return { ...overlay, insert: [...(overlay.insert ?? []), op] };
}

// ─── Save-time validation (fatal problems on OVERLAY-INSERTED elements) ─────

export function validateInserted(preview: MergePreview): OverlayProblem[] {
  const problems: OverlayProblem[] = [];
  const seen = new Set<string>();

  const isBodySection = (id: string): boolean => {
    const inHeader = preview.displayDoc.pageHeader
      && [...walkOne(preview.displayDoc.pageHeader)].some((n) => n.id === id);
    const inFooter = preview.displayDoc.pageFooter
      && [...walkOne(preview.displayDoc.pageFooter)].some((n) => n.id === id);
    return !inHeader && !inFooter;
  };
  function* walkOne(node: ReportElementNode): Generator<ReportElementNode> {
    yield node;
    for (const child of childElements(node)) yield* walkOne(child);
  }

  const registerId = (id: string) => {
    if (seen.has(id)) problems.push({ id, code: 'duplicateId', values: { id } });
    seen.add(id);
  };

  for (const el of walkElements(preview.displayDoc)) {
    registerId(el.id);
    // Column/pair ids share the document id namespace (they are overlay anchors), so a
    // duplicate anywhere is a problem — mirror the server's subtree id-uniqueness scan.
    if (el.type === 'table') for (const c of el.columns) registerId(c.id);
    if (el.type === 'keyValueGrid') for (const p of el.pairs) registerId(p.id);

    // Column/pair value checks run BEFORE the owner gate, once per item. `metaFor` keys meta
    // by each inserted node's OWN id, so a column added to a *published* table is an insert
    // in its own right while its owner is not — gating these on the owner let such a column
    // save with neither `path` nor `template` (#12). The owner half is not redundant either:
    // a wholly-inserted table registers meta for the table id alone, never for its nested
    // column ids. Published items inside published owners stay unflagged: that content
    // belongs to the definition, not the overlay.
    const ownerInserted = Boolean(preview.meta.get(el.id)?.insertPatchId);
    const isOwnInsert = (itemId: string): boolean => Boolean(preview.meta.get(itemId)?.insertPatchId);
    if (el.type === 'table') {
      for (const c of el.columns ?? []) {
        if (!ownerInserted && !isOwnInsert(c.id)) continue;
        if (!c.path && !c.template) problems.push({ id: c.id, code: 'columnMissingValue' });
      }
    } else if (el.type === 'keyValueGrid') {
      for (const p of el.pairs ?? []) {
        if (!ownerInserted && !isOwnInsert(p.id)) continue;
        if (!p.path && !p.template) problems.push({ id: p.id, code: 'pairMissingValue' });
      }
    }
    if (!ownerInserted) continue;

    if (!Object.hasOwn(KNOWN_ELEMENT_TYPES, el.type)) { problems.push({ id: el.id, code: 'unknownElementType', values: { type: el.type } }); continue; }

    switch (el.type) {
      case 'text':
        if (!el.text || (typeof el.text === 'string' && el.text.trim() === '')) {
          problems.push({ id: el.id, code: 'textElementEmpty' });
        }
        break;
      case 'field':
        if (!el.path) problems.push({ id: el.id, code: 'fieldMissingPath' });
        break;
      case 'table':
        // Per-column values are checked above, for inserted owners and inserted columns alike.
        if (!el.bind) problems.push({ id: el.id, code: 'tableMissingBind' });
        else if (!el.columns?.length) problems.push({ id: el.id, code: 'tableMissingColumns' });
        break;
      case 'image':
        if ((el.source ?? 'tenantLogo') !== 'tenantLogo') {
          problems.push({ id: el.id, code: 'unsupportedImageSource' });
        }
        break;
      case 'pageNumber':
        if (isBodySection(el.id)) problems.push({ id: el.id, code: 'pageNumberInBody' });
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

/** The overlay serialized for the JSON panel / PUT body — stable key order, no meta. */
export function serializeOverlay(overlay: ReportOverlayDoc): string {
  const ordered: ReportOverlayDoc = {
    schemaVersion: overlay.schemaVersion ?? 1,
    reportKey: overlay.reportKey,
    ...(overlay.baseVersion !== undefined ? { baseVersion: overlay.baseVersion } : {}),
    suppress: overlay.suppress ?? [],
    insert: overlay.insert ?? [],
    setProps: overlay.setProps ?? [],
  };
  return JSON.stringify(ordered, null, 2);
}

/** True when the overlay carries no operations (nothing worth saving). */
export function isOverlayEmpty(overlay: ReportOverlayDoc): boolean {
  return !(overlay.suppress?.length || overlay.insert?.length || overlay.setProps?.length);
}
