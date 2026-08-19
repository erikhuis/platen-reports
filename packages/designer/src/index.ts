/**
 * `@platen-reports/designer` — the React report designer.
 *
 * Outline tree, scaled canvas, per-type inspector, dockable JSON panel and preview tab. Below the
 * route it knows nothing about its host: translation, permissions, navigation, error formatting
 * and the reporting API all arrive through `ReportDesignerProvider`.
 *
 * A host writes one thin route wrapper — read the report key from its router, resolve a
 * translator and a permission flag, bind `ReportsApiClient`, mount the provider around
 * `DesignerShell` — and nothing below that wrapper needs to change per host.
 */

// ── The host seam ────────────────────────────────────────────────────────────

export {
  ReportDesignerProvider,
  useReportDesigner,
  useDesignerT,
} from './designerContext';

export type {
  DesignerTranslate,
  DesignerConfirmOptions,
  ReportDesignerContextValue,
  ReportDesignerRuntime,
} from './designerContext';

// ── The designer itself ──────────────────────────────────────────────────────

export { default as DesignerShell, DESIGNER_HEADER_HEIGHT } from './components/DesignerShell';
export type { DesignerLoadedData, DesignerShellProps } from './components/DesignerShell';
export { PROBLEM_MESSAGE_KEYS } from './components/DesignerShell';

// ── Editing models, for a host that drives the designer itself ───────────────

export { useOverlayEditing, loadOverlayDoc } from './useOverlayEditing';
export { useStandardEditing } from './useStandardEditing';

// ── Wording ──────────────────────────────────────────────────────────────────

export {
  DESIGNER_MESSAGES,
  DESIGNER_LOCALES,
  createDesignerTranslate,
} from './messages';
export type { DesignerMessages } from './messages';

// ── Shared bits a host's own chrome may want to match ────────────────────────

export { MONO_FONT } from './components/designerConstants';
export { default as LangText } from './LangText';
