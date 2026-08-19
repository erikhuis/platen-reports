'use client';

/**
 * Issue #2163 — owns tenant-overlay editing state for the designer shell: the overlay
 * document, the live client merge preview (`mergePreview`), the `DesignerEditing`
 * context handed to the panels, and the save flow (validate → PUT → re-fetch to sync
 * the server-stamped `baseVersion`). Read-only callers (permission gate) never
 * construct this; the shell passes `editing: null` and the panels render slice-A style.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReportDefinitionDoc } from '@platen-reports/model';
import { walkNode } from '@platen-reports/model';
import {
  collectAllIds, insertElement, mergePreview, resetElementProp,
  restoreElement, serializeOverlay, setElementProp, suppressElement, validateInserted,
  type OverlayProblem, type OverlayWarning, type OverlayWarningCode, type ReportOverlayDoc,
} from '@platen-reports/model';
import type { DesignerEditing, InsertTarget } from '@platen-reports/model';
import type { ReportOverlayMergeWarning, ReportsApiClient } from '@platen-reports/model';

/**
 * Union the live CLIENT merge warnings with the SERVER warnings captured at the last
 * save/validate, deduped by code + targetId. The client mirror keeps warnings live while
 * editing; the authoritative server set corrects any divergence once the overlay is saved.
 */
function unionWarnings(client: OverlayWarning[], server: OverlayWarning[]): OverlayWarning[] {
  const seen = new Set<string>();
  const merged: OverlayWarning[] = [];
  for (const w of [...client, ...server]) {
    const key = `${w.code}::${w.targetId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(w);
  }
  return merged;
}

/** Map a server merge warning (patchId/message) onto the client OverlayWarning shape. */
function toClientWarning(w: ReportOverlayMergeWarning): OverlayWarning {
  return { code: w.code as OverlayWarningCode, targetId: w.targetId ?? undefined, detail: w.message };
}

export interface OverlayEditingState {
  /** The document the panels render: standard + overlay, suppressed nodes kept for ghosting. */
  displayDoc: ReportDefinitionDoc;
  /** The current overlay document (for id-collision checks in the add-block dialog). */
  overlay: ReportOverlayDoc;
  /** The overlay serialized for the JSON panel's Overlay tab. */
  overlayJson: string;
  /** The effective (suppressed-removed) document, matching the server, for the Effective tab. */
  effectiveJson: string;
  editing: DesignerEditing;
  warnings: OverlayWarning[];
  problems: OverlayProblem[];
  dirty: boolean;
  baseVersionOutdated: boolean;
  saving: boolean;
  saveError: string | null;
  /** Resolves the error message that just occurred, or `null` on success. */
  save: () => Promise<string | null>;
  /** Resolves the error message that just occurred, or `null` on success. */
  revert: () => Promise<string | null>;
}

/** Load the stored overlay for a report; null when none exists. */
export async function loadOverlayDoc(api: ReportsApiClient, reportKey: string): Promise<{
  overlay: ReportOverlayDoc; isEnabled: boolean;
} | null> {
  const stored = await api.getOverlay(reportKey);
  if (!stored) return null;
  const overlay = JSON.parse(stored.overlayJson) as ReportOverlayDoc;
  return { overlay, isEnabled: stored.isEnabled };
}

interface UseOverlayEditingArgs {
  /** The host's reporting API port (#2445) — injected, never imported, so this hook ships. */
  api: ReportsApiClient;
  reportKey: string;
  standard: ReportDefinitionDoc;
  initialOverlay: ReportOverlayDoc;
  initialEnabled: boolean;
  /** Formats a thrown value for display — the host contract's `onError` (#2444). */
  onError: (e: unknown) => string;
  /** Called after a successful save/revert so the shell can refresh chrome (catalogue, effective JSON). */
  onSaved?: () => void | Promise<void>;
}

export function useOverlayEditing({
  api, reportKey, standard, initialOverlay, initialEnabled, onError, onSaved,
}: UseOverlayEditingArgs): OverlayEditingState {
  const [overlay, setOverlay] = useState<ReportOverlayDoc>(initialOverlay);
  const [isEnabled, setIsEnabled] = useState(initialEnabled);
  const [savedOverlayJson, setSavedOverlayJson] = useState(() => serializeOverlay(initialOverlay));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Server warnings from the last validate/save — unioned with the live client set so the
  // shell surfaces anything the client mirror diverged on (e.g. SuppressBlocked nuances).
  const [serverWarnings, setServerWarnings] = useState<OverlayWarning[]>([]);

  const preview = useMemo(() => mergePreview(standard, overlay), [standard, overlay]);

  // A ref so the imperative gesture callbacks (captured once, handed into panels) always
  // compile against the freshest overlay + preview without re-creating the context.
  const stateRef = useRef({ overlay, preview });
  stateRef.current = { overlay, preview };

  const insertTargetFor = useCallback((selectedId: string): InsertTarget => {
    const doc = stateRef.current.preview.displayDoc;
    // Which section owns the selected element (drives the pageNumber palette lock).
    const section = ((): 'header' | 'body' | 'footer' => {
      if (doc.pageHeader && [...walkNode(doc.pageHeader)].some((n) => n.id === selectedId)) return 'header';
      if (doc.pageFooter && [...walkNode(doc.pageFooter)].some((n) => n.id === selectedId)) return 'footer';
      return 'body';
    })();
    // Anchor after the selected element if it is a body top-level element; otherwise
    // append into the body (the spec's default: last sibling `after`, `$body` for top).
    const topLevel = (doc.body ?? []).some((n) => n.id === selectedId);
    if (topLevel) return { anchor: selectedId, position: 'after', section: 'body' };
    return { anchor: '$body', position: 'appendInto', section };
  }, []);

  const editing = useMemo<DesignerEditing>(() => ({
    mode: 'overlay',
    meta: preview.meta,
    isOverlayInsert: (id) => Boolean(stateRef.current.preview.meta.get(id)?.insertPatchId),
    isSuppressed: (id) => Boolean(stateRef.current.preview.meta.get(id)?.suppressed),
    touchedProps: (id) => stateRef.current.preview.meta.get(id)?.touchedProps ?? EMPTY_SET,
    // Tenant mode locks structure the standard owns — only tenant inserts are structural.
    canEditStructure: (id) => Boolean(stateRef.current.preview.meta.get(id)?.insertPatchId),
    setProp: (id, prop, value, def) =>
      setOverlay((o) => setElementProp(o, stateRef.current.preview.meta, id, prop, value, def)),
    resetProp: (id, prop) =>
      setOverlay((o) => resetElementProp(o, stateRef.current.preview.meta, id, prop)),
    remove: (id) => setOverlay((o) => suppressElement(o, stateRef.current.preview.meta, id)),
    restore: (id) => setOverlay((o) => restoreElement(o, id)),
    insert: (element, target) => {
      const allIds = collectAllIds(stateRef.current.preview.displayDoc, stateRef.current.overlay);
      const newId = String((element as { id?: unknown }).id ?? '');
      setOverlay((o) => insertElement(o, allIds, element, target.anchor, target.position));
      return newId;
    },
    insertTargetFor,
  }), [preview.meta, insertTargetFor]);

  const problems = useMemo(() => validateInserted(preview), [preview]);
  const warnings = useMemo(
    () => unionWarnings(preview.warnings, serverWarnings),
    [preview.warnings, serverWarnings],
  );
  const overlayJson = useMemo(() => serializeOverlay(overlay), [overlay]);
  const effectiveJson = useMemo(() => JSON.stringify(preview.effectiveDoc, null, 2), [preview.effectiveDoc]);
  const dirty = overlayJson !== savedOverlayJson;
  const baseVersionOutdated = preview.warnings.some((w) => w.code === 'BaseVersionOutdated');

  // save/revert resolve the error message DIRECTLY, rather than making the caller read it back
  // off `saveError` after the await. A caller that closed over this hook's return value before
  // calling save()/revert() holds a stale object — `setSaveError` inside here lands in a LATER
  // render, not in that already-captured closure — so reading `saveError` post-await risks
  // showing null, or worse, a PREVIOUS attempt's error. Resolving the value from inside the same
  // async function has no such gap: it is plain local state, not tied to a render at all.
  const save = useCallback(async (): Promise<string | null> => {
    setSaving(true);
    setSaveError(null);
    try {
      const body = serializeOverlay(overlay);
      // Dry-run validate first (surfaces fatal errors before persisting), then PUT.
      const validation = await api.validateOverlay(reportKey, body);
      if (!validation.valid) {
        const message = validation.errors.join(' ');
        setSaveError(message);
        return message;
      }
      // The validate merge is authoritative — surface its warnings alongside the client set.
      setServerWarnings((validation.warnings ?? []).map(toClientWarning));
      await api.putOverlay(reportKey, body, isEnabled);
      // Re-fetch so the server-stamped baseVersion (== current standard) syncs back —
      // clears the BaseVersionOutdated banner without a manual reload.
      const reloaded = await loadOverlayDoc(api, reportKey);
      const next = reloaded?.overlay ?? overlay;
      setOverlay(next);
      setSavedOverlayJson(serializeOverlay(next));
      if (reloaded) setIsEnabled(reloaded.isEnabled);
      await onSaved?.();
      return null;
    } catch (e) {
      const message = onError(e);
      setSaveError(message);
      return message;
    } finally {
      setSaving(false);
    }
  }, [api, overlay, isEnabled, reportKey, onError, onSaved]);

  const revert = useCallback(async (): Promise<string | null> => {
    setSaving(true);
    setSaveError(null);
    try {
      await api.deleteOverlay(reportKey);
      const empty: ReportOverlayDoc = { schemaVersion: 1, reportKey };
      setOverlay(empty);
      setSavedOverlayJson(serializeOverlay(empty));
      setIsEnabled(false);
      setServerWarnings([]);
      await onSaved?.();
      return null;
    } catch (e) {
      const message = onError(e);
      setSaveError(message);
      return message;
    } finally {
      setSaving(false);
    }
  }, [api, reportKey, onError, onSaved]);

  return {
    displayDoc: preview.displayDoc,
    overlay,
    overlayJson,
    effectiveJson,
    editing,
    warnings,
    problems,
    dirty,
    baseVersionOutdated,
    saving,
    saveError,
    save,
    revert,
  };
}

const EMPTY_SET: ReadonlySet<string> = new Set();
