'use client';

/**
 * Editable Report settings (standard mode) + the suppressed-element banner.
 *
 * `EditReportSettingsBody` is rendered only when `editing.settings` is present
 * (standard mode). Every control calls a `DesignerSettingsEditing` callback — the
 * shell mutates the definition document directly. Tenant / read-only modes keep the
 * locked `ReportSettingsBody`.
 *
 * Internal to `inspector/` — the folder's entry point is `DesignerInspector.tsx`.
 */

import { Box, ButtonBase, IconButton, MenuItem, Select, TextField, Tooltip, Typography } from '@mui/material';
import { EyeOff, RotateCcw, Trash2 } from 'lucide-react';
import { useDesignerT } from '../../designerContext';
import {
  ELEMENT_DEFAULTS, countChangedProps,
  type DesignerLanguage,
  type ReportDefinitionDoc,
  type ReportParameterDef,
} from '@platen-reports/model';
import type { DesignerEditing, DesignerSettingsEditing } from '@platen-reports/model';
import LangText from '../../LangText';
import { MONO_FONT as MONO } from '../designerConstants';
import {
  AddItemButton, AdvSection, EditFieldRow, EditNumberInput, EditSeg, EditTextInput, MUTE, NoteText,
  SLATE, asRecord,
} from './primitives';

const RED = '#B91C1C';
const RED_BG = '#FEF2F2';
const RED_BORDER = '#FECACA';

/** Amber "required" accent (mirrors the read-only parameter row). */
const AMBER = '#B45309';

/** Report-parameter types offered by the standard-mode Parameters editor. */
const PARAM_TYPES = ['guid', 'string', 'int', 'decimal', 'date', 'bool'] as const;

export function EditReportSettingsBody({ doc, lang, settings }: {
  doc: ReportDefinitionDoc; lang: DesignerLanguage; settings: DesignerSettingsEditing;
}) {
  const t = useDesignerT();
  const page = asRecord(doc.page ?? {});
  const pageDefaults = ELEMENT_DEFAULTS.page as Record<string, unknown>;
  const baseFont = doc.defaultStyle?.fontSize ?? (ELEMENT_DEFAULTS.style.fontSize as number);
  const parameters = doc.parameters ?? [];
  const pageCount = countChangedProps(page, pageDefaults, ['size', 'orientation', 'margin'])
    + (doc.defaultStyle?.fontSize !== undefined ? 1 : 0);

  const updateParam = (index: number, patch: Partial<ReportParameterDef>) =>
    settings.setParameters(parameters.map((param, i) => (i === index ? { ...param, ...patch } : param)));
  const removeParam = (index: number) =>
    settings.setParameters(parameters.filter((_, i) => i !== index));
  const addParam = () =>
    settings.setParameters([...parameters, { name: 'newParam', type: 'string', required: false }]);

  return (
    <>
      <EditFieldRow label={t('designerFieldReportTitle')} touched={false}>
        <LangText value={doc.title} lang={lang} onChange={(v) => settings.setTitle(v)} />
      </EditFieldRow>
      <EditFieldRow label={t('designerFieldDataSource')} touched={false}>
        <EditTextInput mono value={doc.dataSource ?? ''} onChange={(v) => settings.setDataSource(v)} />
      </EditFieldRow>

      <AdvSection title={t('designerAdvPageSetup')} count={pageCount}>
        <EditFieldRow inline label={t('designerFieldPaperSize')} touched={false}>
          <EditSeg
            value={(page.size as string) ?? (pageDefaults.size as string)}
            onChange={(v) => settings.setPage({ size: String(v) })}
            options={[{ value: 'A4', label: 'A4' }, { value: 'Letter', label: 'Letter' }]}
          />
        </EditFieldRow>
        <EditFieldRow inline label={t('designerFieldOrientation')} touched={false}>
          <EditSeg
            value={(page.orientation as string) ?? (pageDefaults.orientation as string)}
            onChange={(v) => settings.setPage({ orientation: String(v) })}
            options={[
              { value: 'portrait', label: t('designerOrientationPortrait') },
              { value: 'landscape', label: t('designerOrientationLandscape') },
            ]}
          />
        </EditFieldRow>
        <EditFieldRow inline label={t('designerFieldMargin')} touched={false}>
          <EditNumberInput value={(page.margin as number | undefined) ?? (pageDefaults.margin as number)} onChange={(v) => settings.setPage({ margin: v })} />
        </EditFieldRow>
        <EditFieldRow inline label={t('designerFieldBaseFont')} touched={false}>
          <EditNumberInput value={baseFont} onChange={(v) => settings.setBaseFontSize(v)} />
        </EditFieldRow>
      </AdvSection>

      <AdvSection
        title={t('designerAdvParameters')}
        count={parameters.length}
        badgeLabel={parameters.length > 0 ? t('designerParamsBadge', { count: parameters.length }) : undefined}
      >
        {parameters.map((param, index) => (
          <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <TextField
              size="small"
              value={param.name}
              onChange={(e) => updateParam(index, { name: e.target.value })}
              sx={{ flexGrow: 1, minWidth: 0 }}
              inputProps={{ style: { fontFamily: MONO, fontSize: 12 }, 'aria-label': t('designerParamName') }}
            />
            <Select
              size="small"
              value={param.type ?? 'string'}
              onChange={(e) => updateParam(index, { type: e.target.value })}
              inputProps={{ 'aria-label': t('designerParamType') }}
              sx={{ width: 92, '& .MuiSelect-select': { fontSize: 12, fontFamily: MONO, py: 0.5 } }}
            >
              {PARAM_TYPES.map((type) => <MenuItem key={type} value={type} sx={{ fontSize: 12, fontFamily: MONO }}>{type}</MenuItem>)}
            </Select>
            <Tooltip title={param.required ? t('designerParamRequired') : t('designerParamOptional')}>
              <ButtonBase
                aria-label={param.required ? t('designerParamRequired') : t('designerParamOptional')}
                onClick={() => updateParam(index, { required: !param.required })}
                sx={{ fontSize: 10, fontWeight: 700, color: param.required ? AMBER : MUTE, px: 0.5, py: 0.25, borderRadius: '6px' }}
              >
                {t(param.required ? 'designerParamRequired' : 'designerParamOptional')}
              </ButtonBase>
            </Tooltip>
            <IconButton size="small" aria-label={t('designerRemoveParameter')} onClick={() => removeParam(index)} sx={{ p: 0.25, color: MUTE }}>
              <Trash2 size={13} />
            </IconButton>
          </Box>
        ))}
        <AddItemButton label={t('designerAddParameter')} testId="add-parameter-button" onClick={addParam} />
        <NoteText>{t('designerParamsNote')}</NoteText>
      </AdvSection>

      <AdvSection title={t('designerAdvIdentity')} count={0}>
        <EditFieldRow inline label={t('designerFieldKey')} touched={false}>
          <EditTextInput mono value={doc.key} onChange={(v) => settings.setKey(v)} />
        </EditFieldRow>
        <EditFieldRow inline label={t('designerFieldVersion')} touched={false}>
          <EditTextInput mono value={doc.version} onChange={(v) => settings.setVersion(v)} />
        </EditFieldRow>
        <EditFieldRow label={t('designerFieldPermission')} touched={false}>
          <EditTextInput mono value={doc.requiredPermission ?? ''} onChange={(v) => settings.setRequiredPermission(v)} />
        </EditFieldRow>
      </AdvSection>
    </>
  );
}

/** Red "Hidden by this overlay" banner + Restore, shown atop a suppressed element. */
export function SuppressedBanner({ id, editing }: { id: string; editing: DesignerEditing }) {
  const t = useDesignerT();
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1,
      bgcolor: RED_BG, border: `1px solid ${RED_BORDER}`, borderRadius: '10px', px: 1.5, py: 1,
    }}>
      <Box component="span" sx={{ color: RED, display: 'flex', flexShrink: 0 }}><EyeOff size={15} /></Box>
      <Typography sx={{ fontSize: 12, color: '#7F1D1D', flexGrow: 1 }}>{t('designerHiddenByOverlay')}</Typography>
      <ButtonBase
        onClick={() => editing.restore(id)}
        sx={{
          fontSize: 11.5, fontWeight: 600, color: SLATE, bgcolor: '#fff',
          border: '1px solid', borderColor: 'divider', borderRadius: '8px', px: 1, py: 0.5, gap: 0.5,
        }}
      >
        <RotateCcw size={12} />
        {t('designerRestore')}
      </ButtonBase>
    </Box>
  );
}
