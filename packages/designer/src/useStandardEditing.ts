'use client';

/**
 * Issue #2164 — owns standard-definition authoring state for the designer shell: the
 * definition document, the `DesignerEditing` context (structure fully unlocked, direct
 * mutation — no overlay ops), Report-settings editing, client-side validation, and the
 * export (Save = download/copy the JSON to commit into the repo; there is deliberately no
 * write API). Mirrors the shape of `useOverlayEditing` so the shell wires either.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type {
  LocalizedTextValue, ReportDefinitionDoc, ReportPageSetup, ReportParameterDef,
} from '@platen-reports/model';
import type { OverlayProblem } from '@platen-reports/model';
import {
  deleteNode, insertNode, reorderSiblings, sectionOf, serializeDefinition, setNodeProp,
  validateDefinition,
} from '@platen-reports/model';
import type { DesignerEditing, DesignerSettingsEditing, InsertTarget } from '@platen-reports/model';

export interface StandardEditingState {
  doc: ReportDefinitionDoc;
  definitionJson: string;
  editing: DesignerEditing;
  problems: OverlayProblem[];
  dirty: boolean;
  /** Suggested export filename `<key>.<version>.json`. */
  exportFileName: string;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

export function useStandardEditing(initial: ReportDefinitionDoc): StandardEditingState {
  const [doc, setDoc] = useState<ReportDefinitionDoc>(initial);
  const initialJsonRef = useRef(serializeDefinition(initial));

  const docRef = useRef(doc);
  docRef.current = doc;

  const insertTargetFor = useCallback((selectedId: string): InsertTarget => {
    const d = docRef.current;
    const topLevel = (d.body ?? []).some((n) => n.id === selectedId);
    if (topLevel) return { anchor: selectedId, position: 'after', section: 'body' };
    return { anchor: '$body', position: 'appendInto', section: sectionOf(d, selectedId) };
  }, []);

  const settings = useMemo<DesignerSettingsEditing>(() => ({
    setTitle: (value: LocalizedTextValue) => setDoc((d) => ({ ...d, title: value })),
    setDataSource: (value: string) => setDoc((d) => ({ ...d, dataSource: value })),
    setKey: (value: string) => setDoc((d) => ({ ...d, key: value })),
    setVersion: (value: string) => setDoc((d) => ({ ...d, version: value })),
    setRequiredPermission: (value: string) => setDoc((d) => ({ ...d, requiredPermission: value || undefined })),
    setPage: (patch: Partial<ReportPageSetup>) => setDoc((d) => ({ ...d, page: { ...d.page, ...patch } })),
    setBaseFontSize: (value: number | undefined) =>
      setDoc((d) => {
        // Only touch `fontSize`; keep any sibling defaultStyle keys, and drop the object when empty.
        const next: Record<string, unknown> = { ...d.defaultStyle };
        if (value === undefined) delete next.fontSize; else next.fontSize = value;
        return { ...d, defaultStyle: Object.keys(next).length ? next : undefined };
      }),
    setParameters: (params: ReportParameterDef[]) => setDoc((d) => ({ ...d, parameters: params })),
  }), []);

  const editing = useMemo<DesignerEditing>(() => ({
    mode: 'definition',
    meta: new Map(),
    isOverlayInsert: () => false,
    isSuppressed: () => false,
    touchedProps: () => EMPTY_SET,
    canEditStructure: () => true,
    setProp: (id, prop, value, def) => setDoc((d) => setNodeProp(d, id, prop, value, def)),
    resetProp: (id, prop) => setDoc((d) => setNodeProp(d, id, prop, undefined, undefined)),
    remove: (id) => setDoc((d) => deleteNode(d, id)),
    restore: () => {},
    insert: (element, target) => {
      const newId = String((element as { id?: unknown }).id ?? '');
      setDoc((d) => insertNode(d, element, target));
      return newId;
    },
    insertTargetFor,
    reorder: (parentId, fromIndex, toIndex) => setDoc((d) => reorderSiblings(d, parentId, fromIndex, toIndex)),
    settings,
  }), [insertTargetFor, settings]);

  const problems = useMemo(() => validateDefinition(doc), [doc]);
  const definitionJson = useMemo(() => serializeDefinition(doc), [doc]);
  const dirty = definitionJson !== initialJsonRef.current;
  const exportFileName = `${doc.key}.${doc.version}.json`;

  return { doc, definitionJson, editing, problems, dirty, exportFileName };
}
