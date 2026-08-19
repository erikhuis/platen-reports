'use client';

/**
 * Issue #2162 slice A — per-type inspector (right panel, 310px).
 *
 * Displays the selected element's essential properties and collapses everything
 * else into "Advanced" accordions whose badge counts overridden props against
 * `ELEMENT_DEFAULTS` (teal "n changed" pill, gray "defaults"). Read-only until a
 * `DesignerEditing` contract is threaded in, at which point allowlisted props become
 * inputs that compile to overlay ops. Layout/tokens per
 * `docs/design_handoff_report_designer/README.md` §Inspector.
 *
 * This is the entry point of the `inspector/` folder (issue #2443): the shell picks
 * the header chrome and body for the current selection; every section lives in a
 * sibling module (`primitives`, `readOnlySections`, `editSections`, `editBodies`,
 * `EditReportSettings`) that is internal to the folder.
 */

import { useMemo, type ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { Settings, Table2, Type } from 'lucide-react';
import { useDesignerT } from '../../designerContext';
import {
  REPORT_SETTINGS_ID, findSelection,
  type DesignerLanguage,
  type ReportDefinitionDoc,
} from '@platen-reports/model';
import type { ReportOverlayDoc } from '@platen-reports/model';
import type { DesignerEditing } from '@platen-reports/model';
import {
  MONO_FONT as MONO, TEAL, TENANT_BADGE, TYPE_ICONS,
} from '../designerConstants';
import { INK, LockedControl, MUTE } from './primitives';
import { ElementBody, PairBody, ReportSettingsBody, TableColumnBody } from './readOnlySections';
import { EditElementBody, EditPairBody, EditTableColumnBody } from './editBodies';
import { EditReportSettingsBody, SuppressedBanner } from './EditReportSettings';

export interface DesignerInspectorProps {
  doc: ReportDefinitionDoc;
  lang: DesignerLanguage;
  selectedId: string;
  /** Dotted path → field type map (from GET /reports/{key}/fields), for value-row suffixes. */
  fieldTypes?: Map<string, string>;
  /**
   * Tenant-overlay editing contract. When omitted the inspector is read-only (slice A);
   * when present, allowlisted props become editable and compile to overlay ops.
   */
  editing?: DesignerEditing;
  /** Current overlay — for collision-free ids when adding a table column / grid pair. */
  overlay?: ReportOverlayDoc;
  /** Selects a newly added column/pair (threaded from the shell's setSelectedId). */
  onSelect?: (id: string) => void;
}

export default function DesignerInspector({ doc, lang, selectedId, fieldTypes, editing, overlay, onSelect }: DesignerInspectorProps) {
  const t = useDesignerT();

  // Known field paths (sorted) power the path/bind/groupBy datalists in standard mode.
  const pathOptions = useMemo(
    () => (fieldTypes ? [...fieldTypes.keys()].sort() : undefined),
    [fieldTypes],
  );

  let icon: ReactNode;
  let label: string;
  let headerId: string;
  let body: ReactNode;

  const found = selectedId === REPORT_SETTINGS_ID ? null : findSelection(doc, selectedId);
  if (selectedId === REPORT_SETTINGS_ID) {
    icon = <Settings size={16} />;
    label = t('designerTypeReportSettings');
    headerId = doc.key;
    // Standard mode (editing.settings present) → fully editable settings. Tenant mode
    // keeps the structure locked read-only; slice-A read-only when no editing at all.
    body = editing?.settings
      ? <EditReportSettingsBody doc={doc} lang={lang} settings={editing.settings} />
      : editing
        ? <LockedControl note={t('designerLockReportSettings')}><ReportSettingsBody doc={doc} lang={lang} /></LockedControl>
        : <ReportSettingsBody doc={doc} lang={lang} />;
  } else if (!found) {
    icon = <Settings size={16} />;
    label = t('designerNoSelection');
    headerId = '';
    body = <Typography sx={{ fontSize: 12.5, color: MUTE }}>{t('designerNothingSelected')}</Typography>;
  } else if (found.column) {
    icon = <Table2 size={16} />;
    label = t('designerTypeTableColumn');
    headerId = found.column.id;
    body = editing
      ? <EditTableColumnBody column={found.column} id={found.column.id} lang={lang} editing={editing} pathOptions={pathOptions} />
      : <TableColumnBody column={found.column} lang={lang} fieldTypes={fieldTypes} />;
  } else if (found.pair) {
    icon = <Type size={16} />;
    label = t('designerTypePair');
    headerId = found.pair.id;
    body = editing
      ? <EditPairBody pair={found.pair} id={found.pair.id} lang={lang} editing={editing} pathOptions={pathOptions} />
      : <PairBody pair={found.pair} lang={lang} fieldTypes={fieldTypes} />;
  } else {
    const element = found.element;
    const IconComponent = TYPE_ICONS[element.type] ?? Type;
    icon = <IconComponent size={16} />;
    label = t(`elementType.${element.type}`);
    headerId = element.id;
    body = editing
      ? <EditElementBody element={element} id={element.id} lang={lang} editing={editing} doc={doc} overlay={overlay} onSelect={onSelect} pathOptions={pathOptions} />
      : <ElementBody element={element} lang={lang} fieldTypes={fieldTypes} />;
  }

  const isInsert = !!editing && headerId !== '' && selectedId !== REPORT_SETTINGS_ID && editing.isOverlayInsert(selectedId);
  const isSuppressed = !!editing && selectedId !== REPORT_SETTINGS_ID && editing.isSuppressed(selectedId);

  return (
    <Box data-testid="designer-inspector" sx={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header: type icon · type label · (TENANT badge) · element id right-aligned mono */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <Box component="span" sx={{ color: TEAL, display: 'flex', flexShrink: 0 }}>{icon}</Box>
        <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: INK }} data-testid="inspector-type-label">
          {label}
        </Typography>
        {isInsert && (
          <Box
            component="span"
            data-testid="inspector-tenant-badge"
            sx={{
              fontSize: 9, fontWeight: 700, color: TENANT_BADGE.text, bgcolor: TENANT_BADGE.bg,
              border: `1px solid ${TENANT_BADGE.border}`, borderRadius: '999px', px: 0.875, py: 0.125,
            }}
          >
            {t('designerTenantInsertBadge')}
          </Box>
        )}
        <Typography sx={{ ml: 'auto', fontSize: 10.5, fontFamily: MONO, color: MUTE, wordBreak: 'break-all' }} data-testid="inspector-element-id">
          {headerId}
        </Typography>
      </Box>

      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.75, flexGrow: 1 }}>
        {isSuppressed && editing && <SuppressedBanner id={selectedId} editing={editing} />}
        {body}
      </Box>

      {/* Pinned footer note: the override-dot legend (+ tenant sentence in overlay mode only). */}
      <Box sx={{ mt: 'auto', mx: 2, py: 1.75, borderTop: '1px dashed', borderColor: 'divider', display: 'flex', gap: 0.75, alignItems: 'flex-start' }}>
        <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: TEAL, mt: '5px', flexShrink: 0 }} />
        <Typography sx={{ fontSize: 11.5, color: MUTE, lineHeight: 1.5 }}>
          {t('designerFooterNote')}{editing && editing.mode !== 'definition' ? ` ${t('designerFooterNoteTenant')}` : ''}
        </Typography>
      </Box>
    </Box>
  );
}
