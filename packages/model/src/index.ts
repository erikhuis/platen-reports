/**
 * `@platen-reports/model` — the report definition model, the customisation-overlay algebra,
 * and the wire contracts.
 *
 * No framework and no runtime dependencies, deliberately. Two consumers need that:
 * `@platen-reports/designer`, which is React but should not force React on anyone reading a
 * definition; and the conformance suite, which runs this merger and the C# one over the same
 * fixtures in plain Node and compares the results.
 *
 * Everything is re-exported from here. Deep imports into `./overlayModel` and friends are not
 * part of the public surface and may be reorganised.
 */

// ── The document model ───────────────────────────────────────────────────────

export type {
  LocalizedTextValue,
  ReportStyleProps,
  TextElementNode,
  FieldElementNode,
  RowElementNode,
  ColumnElementNode,
  ContainerElementNode,
  TableColumnNode,
  TableTotalNode,
  TableElementNode,
  KeyValuePairNode,
  KeyValueGridElementNode,
  SpacerElementNode,
  LineElementNode,
  ImageElementNode,
  PageNumberElementNode,
  ReportElementNode,
  ReportElementType,
  ReportParameterDef,
  ReportPageSetup,
  ReportDefinitionDoc,
  DesignerLanguage,
  FoundSelection,
} from './designerModel';

export {
  REPORT_SETTINGS_ID,
  DESIGNER_LANGUAGES,
  ELEMENT_DEFAULTS,
  resolveLocalized,
  countChangedProps,
  childElements,
  walkNode,
  walkElements,
  findSelection,
  findJsonObjectRange,
} from './designerModel';

// ── Customisation overlays: the patch algebra and its merge ──────────────────

export type {
  OverlayWarningCode,
  OverlayWarning,
  OverlayProblemCode,
  OverlayProblem,
  OverlayInsertOp,
  OverlaySetPropsOp,
  ReportOverlayDoc,
  OverlayNodeMeta,
  MergePreview,
} from './overlayModel';

export {
  BODY_PSEUDO_ANCHOR,
  SET_PROPS_ALLOWED_ROOTS,
  isAllowedSetProp,
  collectDocIds,
  collectAllIds,
  collectSubtreeIds,
  nextId,
  mergePreview,
  setElementProp,
  resetElementProp,
  suppressElement,
  restoreElement,
  insertElement,
  validateInserted,
  serializeOverlay,
  isOverlayEmpty,
} from './overlayModel';

// ── Authoring a definition directly, rather than patching one ────────────────

export {
  setNodeProp,
  deleteNode,
  insertNode,
  reorderSiblings,
  sectionOf,
  validateDefinition,
  serializeDefinition,
} from './standardModel';

// ── Wire contracts: what a host's reporting API speaks ───────────────────────

export type {
  ReportCatalogueItem,
  ReportParameter,
  ReportOverlayMergeWarning,
  ReportEffectiveDefinition,
  ReportOverlay,
  ReportOverlayValidationResult,
  ReportFieldNode,
  ReportPreviewRequest,
  ReportsApiClient,
} from './contracts';

// ── The editing contract the designer's panels are handed ────────────────────

export type {
  InsertTarget,
  DesignerSettingsEditing,
  DesignerEditing,
} from './designerEditing';
