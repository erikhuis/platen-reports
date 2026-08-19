'use client';

/**
 * The designer proper — everything below the route wrapper (#2444).
 *
 * Owns the header bar, the editing hooks, and the Design/Preview column layout. It
 * knows nothing about the host's router, i18n library or permission system: the
 * translator, the `canEdit` flag, the error formatter, the confirm dialog and the two
 * navigation callbacks all arrive through `ReportDesignerProvider`, and the report
 * itself arrives as a plain `reportKey` + pre-loaded `data`.
 *
 * The AppShell-undoing `m: -3` / `calc(100vh - 48px)` frame stays at route level —
 * it is a fact about the host's layout, not about the designer.
 *
 * Slice A (#2162) built the read-only surface; slice B (#2163) added tenant-overlay
 * editing (every gesture compiles to suppress / insert / setProps ops); #2164 added
 * full standard-definition authoring. Layout + tokens per
 * `docs/design_handoff_report_designer/README.md`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, MenuItem, Popover, Select, Snackbar,
  ToggleButton, ToggleButtonGroup, Tooltip, IconButton, Typography,
} from '@mui/material';
import {
  AlertTriangle, ArrowLeft, Braces, Download, Eye, PanelLeft, PanelRight, PencilRuler, Save, SquareDashed, Trash2,
} from 'lucide-react';
import { useDesignerT, useReportDesigner } from '../designerContext';
import type { ReportCatalogueItem } from '@platen-reports/model';
import {
  DESIGNER_LANGUAGES, REPORT_SETTINGS_ID,
  type DesignerLanguage, type ReportDefinitionDoc,
} from '@platen-reports/model';
import type { OverlayProblemCode, ReportOverlayDoc } from '@platen-reports/model';
import DesignerOutline from './DesignerOutline';
import DesignerCanvas from './DesignerCanvas';
import DesignerInspector from './inspector/DesignerInspector';
import DesignerJsonPanel from './DesignerJsonPanel';
import DesignerPreviewTab from './DesignerPreviewTab';
import ExportDialog from './ExportDialog';
import {
  MONO_FONT, STANDARD_BADGE_VIOLET, TENANT_BADGE, VIOLET_BG, VIOLET_BORDER,
} from './designerConstants';
import { useOverlayEditing } from '../useOverlayEditing';
import { useStandardEditing } from '../useStandardEditing';

export const DESIGNER_HEADER_HEIGHT = 54;

/**
 * Issue #2446 — the model emits machine `OverlayProblemCode`s, never translation keys, so the
 * designer owns this mapping. Typing it as a `Record` over the closed union is the
 * exhaustiveness check: adding a code to the model fails this file to compile until it is
 * given wording. Exported so `designerMessages.test.tsx` can assert the wording actually
 * exists in every locale — the Record proves each code has a *key*, not that the key resolves.
 */
export const PROBLEM_MESSAGE_KEYS: Record<OverlayProblemCode, string> = {
  documentMissingKey: 'designerProblemMissingKey',
  documentMissingVersion: 'designerProblemMissingVersion',
  documentMissingDataSource: 'designerProblemMissingDataSource',
  parameterMissingName: 'designerProblemParamNoName',
  elementMissingId: 'designerProblemMissingId',
  duplicateId: 'designerProblemDuplicateId',
  unknownElementType: 'designerProblemUnknownType',
  textElementEmpty: 'designerProblemEmptyText',
  fieldMissingPath: 'designerProblemFieldNoPath',
  tableMissingBind: 'designerProblemTableNoBind',
  tableMissingColumns: 'designerProblemTableNoColumns',
  columnMissingValue: 'designerProblemColumnNoValue',
  pairMissingValue: 'designerProblemPairNoValue',
  unsupportedImageSource: 'designerProblemImageSource',
  pageNumberInBody: 'designerProblemPageNumberInBody',
  invalidContainerWidth: 'designerProblemContainerWidth',
};

const OUTLINE_WIDTH = 232;
const INSPECTOR_WIDTH = 310;
/** Below this window width the docked JSON panel auto-hides in Design mode (design spec). */
const JSON_AUTOHIDE_BELOW = 1160;

type DesignerMode = 'design' | 'preview';
type JsonDock = 'left' | 'right' | 'hidden';

/** Everything the route wrapper loads before the designer can mount. */
export interface DesignerLoadedData {
  catalogue: ReportCatalogueItem[];
  standardDoc: ReportDefinitionDoc;
  standardJson: string;
  effectiveDoc: ReportDefinitionDoc;
  effectiveJson: string;
  fieldTypes?: Map<string, string>;
  initialOverlay: ReportOverlayDoc;
  initialEnabled: boolean;
}

export interface DesignerShellProps {
  reportKey: string;
  data: DesignerLoadedData;
  /** Called after a successful save/revert so the host can refetch the catalogue + definitions. */
  onSaved: () => void;
}

export default function DesignerShell({ reportKey, data, onSaved }: DesignerShellProps) {
  const t = useDesignerT();
  const { api, canEdit, onBack, onSelectReport, onError, confirm } = useReportDesigner();

  const [selectedId, setSelectedId] = useState<string>(REPORT_SETTINGS_ID);
  const [lang, setLang] = useState<DesignerLanguage>('en');
  const [mode, setMode] = useState<DesignerMode>('design');
  // Which editing surface a permitted user is in: tenant overlay (default) or full
  // standard-definition authoring (#2164). Read-only users have neither.
  const [authoring, setAuthoring] = useState<'tenant' | 'standard'>('tenant');
  const [jsonDock, setJsonDock] = useState<JsonDock>('right');
  const [autoHideToast, setAutoHideToast] = useState(false);
  const [warningsAnchor, setWarningsAnchor] = useState<HTMLElement | null>(null);
  const [problemsAnchor, setProblemsAnchor] = useState<HTMLElement | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const requestedDockRef = useRef<JsonDock>('right');

  // Both editing hooks always run (the standard doc is loaded); the active one is chosen
  // below. Read-only viewers get neither `editing` and see the effective doc.
  const overlayState = useOverlayEditing({
    api,
    reportKey,
    standard: data.standardDoc,
    initialOverlay: data.initialOverlay,
    initialEnabled: data.initialEnabled,
    onError,
    onSaved,
  });
  const standardState = useStandardEditing(data.standardDoc);

  const tenantMode = canEdit && authoring === 'tenant';
  const standardMode = canEdit && authoring === 'standard';
  const editing = standardMode ? standardState.editing : tenantMode ? overlayState.editing : undefined;
  const doc = standardMode ? standardState.doc : tenantMode ? overlayState.displayDoc : data.effectiveDoc;

  // Canvas scale from the center column width: clamp(0.35, (w − 48) / 620, 1).
  const centerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = centerRef.current;
    if (!el || mode !== 'design') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 620;
      setScale(Math.min(1, Math.max(0.35, (width - 48) / 620)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [mode]);

  // Auto-hide the JSON dock on narrow windows (with a toast); Design mode only.
  useEffect(() => {
    if (mode !== 'design') return;
    const onResize = () => {
      const narrow = window.innerWidth < JSON_AUTOHIDE_BELOW;
      if (narrow && jsonDock !== 'hidden') {
        requestedDockRef.current = jsonDock;
        setJsonDock('hidden');
        setAutoHideToast(true);
      } else if (!narrow && jsonDock === 'hidden' && requestedDockRef.current !== 'hidden') {
        setJsonDock(requestedDockRef.current);
      }
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [mode, jsonDock]);

  const setDockRequested = useCallback((dock: JsonDock) => {
    requestedDockRef.current = dock;
    const autoHide = window.innerWidth < JSON_AUTOHIDE_BELOW && dock !== 'hidden';
    setJsonDock(autoHide ? 'hidden' : dock);
    if (autoHide) setAutoHideToast(true);
  }, []);

  const report = useMemo(
    () => data.catalogue.find((r) => r.key === reportKey) ?? null,
    [data.catalogue, reportKey],
  );

  const handleSave = useCallback(async () => {
    // save() resolves the error itself — do not read overlayState.saveError here, it is the
    // pre-call render's stale snapshot (see useOverlayEditing.ts's save/revert doc comment).
    const error = await overlayState.save();
    setSaveToast(error === null ? t('saved') : (error || t('designerSaveFailed')));
  }, [overlayState, t]);

  const handleRevert = useCallback(async () => {
    const confirmed = await confirm({
      title: t('revertToStandard'),
      body: t('designerRevertConfirm'),
      confirmLabel: t('revertToStandard'),
    });
    if (!confirmed) return;
    const error = await overlayState.revert();
    setSaveToast(error === null ? t('overlayDeleted') : (error || t('designerSaveFailed')));
  }, [confirm, overlayState, t]);

  const jsonPanel = jsonDock !== 'hidden' && (
    <DesignerJsonPanel
      standardJson={data.standardJson}
      // Standard mode edits the definition itself — the "effective" tab shows the live draft.
      effectiveJson={standardMode ? standardState.definitionJson : tenantMode ? overlayState.effectiveJson : data.effectiveJson}
      overlayJson={tenantMode ? overlayState.overlayJson : undefined}
      selectedId={selectedId}
    />
  );

  return (
    <>
      {/* ── Header bar ─────────────────────────────────────────────────── */}
      <Box sx={{
        height: DESIGNER_HEADER_HEIGHT, flexShrink: 0, display: 'flex', alignItems: 'center',
        gap: 1.5, px: 1.5, bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider',
      }}>
        {onBack && (
          <Tooltip title={t('back')}>
            <IconButton size="small" onClick={onBack} data-testid="designer-back">
              <ArrowLeft size={18} />
            </IconButton>
          </Tooltip>
        )}

        <Select
          size="small"
          value={reportKey}
          disabled={!onSelectReport}
          onChange={(e) => onSelectReport?.(e.target.value)}
          data-testid="designer-report-switcher"
          sx={{ minWidth: 260, '& .MuiSelect-select': { py: 0.5 } }}
        >
          {data.catalogue.map((r) => (
            <MenuItem key={r.key} value={r.key}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" fontWeight={600}>{r.title}</Typography>
                <Typography variant="caption" sx={{ fontFamily: MONO_FONT, color: 'text.secondary' }}>
                  {r.key} · v{r.version}
                </Typography>
                {r.overlayEnabled ? (
                  <Chip label={t('designerCustomizedBadge')} size="small"
                    sx={{ height: 16, fontSize: 9, fontWeight: 700, color: TENANT_BADGE.text, bgcolor: TENANT_BADGE.bg, border: `1px solid ${TENANT_BADGE.border}` }} />
                ) : (
                  <Chip label={t('designerStandardBadge')} size="small"
                    sx={{ height: 16, fontSize: 9, fontWeight: 700, color: STANDARD_BADGE_VIOLET, bgcolor: VIOLET_BG, border: `1px solid ${VIOLET_BORDER}` }} />
                )}
              </Box>
            </MenuItem>
          ))}
        </Select>

        {/* Edit-mode selector (permitted users): tenant overlay vs standard authoring. */}
        {canEdit && (
          <ToggleButtonGroup
            size="small" exclusive value={authoring}
            onChange={(_, v: 'tenant' | 'standard' | null) => { if (v) setAuthoring(v); }}
            aria-label={t('designerAuthoringSeg')} data-testid="designer-authoring-seg"
          >
            <ToggleButton value="tenant" sx={{ px: 1, py: 0.25, fontSize: 11 }}>{t('designerAuthoringTenant')}</ToggleButton>
            <ToggleButton value="standard" sx={{ px: 1, py: 0.25, fontSize: 11 }}>{t('designerAuthoringStandard')}</ToggleButton>
          </ToggleButtonGroup>
        )}

        {tenantMode && (
          <Chip
            label={t('designerTenantOverlayBadge')}
            size="small"
            data-testid="designer-tenant-badge"
            sx={{ height: 22, fontSize: 10, fontWeight: 700, color: TENANT_BADGE.text, bgcolor: TENANT_BADGE.bg, border: `1px solid ${TENANT_BADGE.border}` }}
          />
        )}
        {standardMode && (
          <Chip
            label={t('designerStandardAuthoringBadge')}
            size="small"
            data-testid="designer-standard-badge"
            sx={{ height: 22, fontSize: 10, fontWeight: 700, color: STANDARD_BADGE_VIOLET, bgcolor: VIOLET_BG, border: `1px solid ${VIOLET_BORDER}` }}
          />
        )}

        <Box sx={{ flexGrow: 1 }} />

        {/* Warnings & problems pills (tenant mode). */}
        {tenantMode && overlayState.problems.length > 0 && (
          <Chip
            icon={<AlertTriangle size={14} />}
            label={t('designerProblemsPill', { count: overlayState.problems.length })}
            size="small" color="error" variant="outlined"
            onClick={(e) => setProblemsAnchor(e.currentTarget)}
            data-testid="designer-problems-pill"
          />
        )}
        {tenantMode && overlayState.warnings.length > 0 && (
          <Chip
            icon={<AlertTriangle size={14} />}
            label={t('designerWarningsPill', { count: overlayState.warnings.length })}
            size="small"
            onClick={(e) => setWarningsAnchor(e.currentTarget)}
            data-testid="designer-warnings-pill"
            sx={{ color: TENANT_BADGE.text, bgcolor: TENANT_BADGE.bg, border: `1px solid ${TENANT_BADGE.border}` }}
          />
        )}
        {standardMode && standardState.problems.length > 0 && (
          <Chip
            icon={<AlertTriangle size={14} />}
            label={t('designerProblemsPill', { count: standardState.problems.length })}
            size="small" color="error" variant="outlined"
            onClick={(e) => setProblemsAnchor(e.currentTarget)}
            data-testid="designer-standard-problems-pill"
          />
        )}

        {/* LocalizedText display language — NOT the UI locale. */}
        <ToggleButtonGroup
          size="small" exclusive value={lang}
          onChange={(_, v: DesignerLanguage | null) => { if (v) setLang(v); }}
          aria-label={t('designerLanguageSeg')} data-testid="designer-lang-seg"
        >
          {DESIGNER_LANGUAGES.map((code) => (
            <ToggleButton key={code} value={code} sx={{ px: 1, py: 0.25, fontSize: 11, fontWeight: 700 }}>
              {code.toUpperCase()}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        <ToggleButtonGroup
          size="small" exclusive value={mode}
          onChange={(_, v: DesignerMode | null) => { if (v) setMode(v); }}
          aria-label={t('designerModeSeg')} data-testid="designer-mode-seg"
        >
          <ToggleButton value="design" sx={{ px: 1.25, py: 0.25, gap: 0.5, fontSize: 12 }}>
            <PencilRuler size={14} /> {t('designerModeDesign')}
          </ToggleButton>
          <ToggleButton value="preview" sx={{ px: 1.25, py: 0.25, gap: 0.5, fontSize: 12 }}>
            <Eye size={14} /> {t('designerModePreview')}
          </ToggleButton>
        </ToggleButtonGroup>

        <ToggleButtonGroup
          size="small" exclusive value={jsonDock}
          onChange={(_, v: JsonDock | null) => { if (v) setDockRequested(v); }}
          aria-label={t('designerJsonSeg')} data-testid="designer-json-seg"
        >
          <ToggleButton value="left" aria-label={t('designerJsonLeft')} sx={{ px: 1, py: 0.25 }}><PanelLeft size={14} /></ToggleButton>
          <ToggleButton value="right" aria-label={t('designerJsonRight')} sx={{ px: 1, py: 0.25 }}><PanelRight size={14} /></ToggleButton>
          <ToggleButton value="hidden" aria-label={t('designerJsonHidden')} sx={{ px: 1, py: 0.25 }}><SquareDashed size={14} /></ToggleButton>
        </ToggleButtonGroup>
        <Braces size={14} style={{ color: '#94A3B8' }} />

        {/* Save / Revert (tenant mode). */}
        {tenantMode && (
          <>
            <Button
              size="small" color="error" variant="text" startIcon={<Trash2 size={15} />}
              disabled={overlayState.saving || !report?.hasOverlay}
              onClick={handleRevert}
              data-testid="designer-revert"
            >
              {t('revertToStandard')}
            </Button>
            <Button
              size="small" variant="contained" startIcon={<Save size={15} />}
              disabled={overlayState.saving || !overlayState.dirty}
              onClick={handleSave}
              data-testid="designer-save"
            >
              {t('save')}
            </Button>
          </>
        )}
        {/* Export (standard authoring — save is an export, there is no write API). */}
        {standardMode && (
          <Button
            size="small" variant="contained" startIcon={<Download size={15} />}
            onClick={() => setExportOpen(true)}
            data-testid="designer-export"
          >
            {t('designerExport')}
          </Button>
        )}
      </Box>

      {/* Tenant explainer banner (+ baseVersion drift). */}
      {tenantMode && (
        <Alert severity="warning" icon={false} data-testid="designer-tenant-banner"
          sx={{ borderRadius: 0, py: 0.25, fontSize: 12, bgcolor: TENANT_BADGE.bg, color: TENANT_BADGE.text }}>
          {t('designerTenantBanner', { title: report?.title ?? reportKey, version: report?.version ?? '' })}
          {overlayState.baseVersionOutdated && ` ${t('designerBaseVersionDrift')}`}
        </Alert>
      )}
      {/* Standard-authoring banner — save is an export into the repo. */}
      {standardMode && (
        <Alert severity="info" icon={false} data-testid="designer-standard-banner"
          sx={{ borderRadius: 0, py: 0.25, fontSize: 12 }}>
          {t('designerStandardBanner')}
        </Alert>
      )}

      {/* ── Content columns ────────────────────────────────────────────── */}
      {mode === 'preview' ? (
        <Box sx={{ flexGrow: 1, display: 'flex', minHeight: 0 }}>
          {jsonDock === 'left' && jsonPanel}
          <DesignerPreviewTab reportKey={reportKey} report={report} lang={lang}
            draftDefinitionJson={standardMode ? standardState.definitionJson : undefined} />
          {jsonDock === 'right' && jsonPanel}
        </Box>
      ) : (
        <Box sx={{ flexGrow: 1, display: 'flex', minHeight: 0 }}>
          {jsonDock === 'left' && jsonPanel}
          <Box sx={{ width: OUTLINE_WIDTH, flexShrink: 0, overflow: 'auto', bgcolor: 'background.paper', borderRight: 1, borderColor: 'divider' }}>
            <DesignerOutline doc={doc} lang={lang} selectedId={selectedId} onSelect={setSelectedId}
              editing={editing} overlay={tenantMode ? overlayState.overlay : undefined} />
          </Box>
          {/* Issue #2200 — the ResizeObserver that drives the canvas `scale` must measure a
              NON-scrolling box. When it watched the scroll container itself, adding a table made
              the scaled sheet large enough to toggle that container's scrollbars, which changed the
              measured width → new scale → resized sheet → scrollbars toggle again … an endless
              "flash between two sizes" loop. So `centerRef` is now an overflow-free outer box (its
              width is purely window/panel-driven), and the canvas scrolls in an inner box.
              `scrollbarGutter: stable` on the inner box is cosmetic only now — it just keeps the
              centered canvas from shifting when the vertical scrollbar appears. */}
          <Box ref={centerRef} sx={{ flexGrow: 1, minWidth: 0, position: 'relative' }}>
            <Box sx={{ position: 'absolute', inset: 0, overflow: 'auto', scrollbarGutter: 'stable', display: 'flex', justifyContent: 'center' }}>
              <DesignerCanvas doc={doc} lang={lang} selectedId={selectedId} onSelect={setSelectedId} scale={scale} fieldTypes={data.fieldTypes} editing={editing} />
            </Box>
          </Box>
          <Box sx={{ width: INSPECTOR_WIDTH, flexShrink: 0, overflow: 'auto', bgcolor: 'background.paper', borderLeft: 1, borderColor: 'divider' }}>
            <DesignerInspector doc={doc} lang={lang} selectedId={selectedId} fieldTypes={data.fieldTypes} editing={editing}
              overlay={tenantMode ? overlayState.overlay : undefined} onSelect={setSelectedId} />
          </Box>
          {jsonDock === 'right' && jsonPanel}
        </Box>
      )}

      {/* Warnings popover. */}
      <Popover
        open={Boolean(warningsAnchor)} anchorEl={warningsAnchor} onClose={() => setWarningsAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Box sx={{ p: 1.5, maxWidth: 360 }}>
          {overlayState.warnings.map((w, i) => (
            <Box key={i} sx={{ mb: 0.75 }}>
              <Typography variant="caption" fontWeight={700} sx={{ fontFamily: MONO_FONT }}>{w.code}</Typography>
              <Typography variant="body2" sx={{ fontSize: 12 }}>{w.detail}</Typography>
            </Box>
          ))}
        </Box>
      </Popover>
      {/* Problems popover. */}
      <Popover
        open={Boolean(problemsAnchor)} anchorEl={problemsAnchor} onClose={() => setProblemsAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Box sx={{ p: 1.5, maxWidth: 360 }}>
          {(standardMode ? standardState.problems : overlayState.problems).map((p, i) => (
            <Box key={i} sx={{ mb: 0.75 }}>
              <Typography variant="caption" fontWeight={700} sx={{ fontFamily: MONO_FONT }}>{p.id}</Typography>
              <Typography variant="body2" sx={{ fontSize: 12 }}>{t(PROBLEM_MESSAGE_KEYS[p.code], p.values)}</Typography>
            </Box>
          ))}
        </Box>
      </Popover>

      {standardMode && (
        <ExportDialog
          open={exportOpen}
          onClose={() => setExportOpen(false)}
          fileName={standardState.exportFileName}
          json={standardState.definitionJson}
          problemCount={standardState.problems.length}
        />
      )}

      <Snackbar
        open={autoHideToast} autoHideDuration={4000} onClose={() => setAutoHideToast(false)}
        message={t('designerJsonAutoHidden')} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
      <Snackbar
        open={Boolean(saveToast)} autoHideDuration={4000} onClose={() => setSaveToast(null)}
        message={saveToast ?? ''} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </>
  );
}
