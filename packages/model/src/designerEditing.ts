/**
 * The editing contract threaded from the designer shell into the outline, canvas and
 * inspector. `null` means read-only. Two editing modes share it:
 *
 *  - **overlay** — edits compile to overlay operations (suppress / insert / setProps), and the
 *    structure the published definition owns is locked; only elements this overlay inserted are
 *    structurally editable.
 *  - **definition** — full structural authoring of the document itself: everything is editable,
 *    elements reorder within their parent, and the report settings (title, page, parameters,
 *    identity) can be changed. Saving is an export, not an API write.
 *
 * Components stay presentational and call back; the shell owns the document and the state.
 */

import type { ReportPageSetup, ReportParameterDef, LocalizedTextValue } from './designerModel';
import type { OverlayNodeMeta, OverlayInsertOp } from './overlayModel';

/** Where a new element may be added, resolved by the shell from the current selection. */
export interface InsertTarget {
  anchor: string;
  position: OverlayInsertOp['position'];
  /** 'body' hides pageNumber from the palette (engine limit — header/footer only). */
  section: 'header' | 'body' | 'footer';
}

/** Standard-mode (document-level) Report-settings editing. */
export interface DesignerSettingsEditing {
  setTitle: (value: LocalizedTextValue) => void;
  setDataSource: (value: string) => void;
  setKey: (value: string) => void;
  setVersion: (value: string) => void;
  setRequiredPermission: (value: string) => void;
  setPage: (patch: Partial<ReportPageSetup>) => void;
  setBaseFontSize: (value: number | undefined) => void;
  setParameters: (params: ReportParameterDef[]) => void;
}

export interface DesignerEditing {
  /**
   * Which editing mode is active — the inspector/outline branch on it for locks & reorder.
   * Optional; treat a missing value as `'overlay'`.
   */
  mode?: 'overlay' | 'definition';

  /** Per-id overlay annotations from the current merge preview. Empty in definition mode. */
  meta: Map<string, OverlayNodeMeta>;

  /** True while the element (or its owning insert) was added by this overlay — edits are unlocked and direct. */
  isOverlayInsert: (id: string) => boolean;
  /** True when the id is currently suppressed by the overlay. */
  isSuppressed: (id: string) => boolean;
  /** The setProps override keys for an id (drives override dots + reset buttons; empty in standard). */
  touchedProps: (id: string) => ReadonlySet<string>;
  /**
   * Whether STRUCTURAL fields (table bind, field path, totals, column/pair CRUD) are editable
   * for this id. Definition mode: always true. Overlay mode: only for this overlay's own
   * inserts. When absent, consumers fall back to `isOverlayInsert`, which is the overlay rule.
   */
  canEditStructure?: (id: string) => boolean;

  /** Compile a property edit (overlay setProps / insert-payload edit, or a direct doc edit in standard mode). */
  setProp: (id: string, prop: string, value: unknown, defaultValue: unknown) => void;
  /** Clear a single override back to its default. Overlay mode. */
  resetProp: (id: string, prop: string) => void;
  /** Delete gesture: suppress a published element, drop one of this overlay's inserts, or delete outright in definition mode. */
  remove: (id: string) => void;
  /** Un-suppress a published element. Overlay mode. */
  restore: (id: string) => void;
  /** Add a new element; returns the new element's id (for selection). */
  insert: (element: Record<string, unknown>, target: InsertTarget) => string;
  /** The insert target for the current selection (last-sibling `after`, `$body` for top level). */
  insertTargetFor: (selectedId: string) => InsertTarget;

  /**
   * Standard mode only — reorder a sibling array in place. `parentId` is 'body', 'header',
   * 'footer', or an element id (container/row/column children, table columns, grid pairs).
   * Undefined in overlay mode: ordering is owned by the published definition.
   */
  reorder?: (parentId: string, fromIndex: number, toIndex: number) => void;

  /** Definition mode only — document-level report-settings editing. Undefined in overlay mode. */
  settings?: DesignerSettingsEditing;
}
