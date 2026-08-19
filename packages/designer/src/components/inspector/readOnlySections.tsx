'use client';

/**
 * Read-only inspector sections (issue #2162 slice A).
 *
 * The shared "Advanced" accordions (`StyleAdv`, `LayoutAdv`, `VisibilityAdv`), the
 * report-settings body, and the per-type element bodies. Nothing here mutates —
 * values render as read-only rows with a teal override dot when they differ from
 * `ELEMENT_DEFAULTS`. Used directly when no `DesignerEditing` contract is threaded
 * in, and inside `LockedControl` when the standard owns the structure.
 *
 * Internal to `inspector/` — the folder's entry point is `DesignerInspector.tsx`.
 */

import { Box, Typography } from '@mui/material';
import { useDesignerT } from '../../designerContext';
import {
  ELEMENT_DEFAULTS, countChangedProps, resolveLocalized,
  type DesignerLanguage,
  type KeyValuePairNode,
  type ReportDefinitionDoc,
  type ReportElementNode,
  type TableColumnNode,
  type TableElementNode,
  type TableTotalNode,
} from '@platen-reports/model';
import { MONO_FONT as MONO } from '../designerConstants';
import {
  AdvSection, FormatRow, INK, ItemList, ListLabel, MUTE, NoteText, PropRow, STYLE_KEYS, STYLE_ROWS,
  ValueSourceRow, alignLabel, asRecord, typeSuffix,
} from './primitives';

// ─── Shared Advanced sections ───────────────────────────────────────────────

function StyleAdv({ element }: { element: ReportElementNode }) {
  const t = useDesignerT();
  const style = asRecord(element.style ?? {});
  // Indexed by a runtime key from STYLE_KEYS/STYLE_ROWS, so widen once here rather than
  // casting at each use. ELEMENT_DEFAULTS keeps its literal keys for everyone else.
  const defaults = ELEMENT_DEFAULTS.style as Record<string, unknown>;
  const count = countChangedProps(style, defaults, STYLE_KEYS);
  const display = (kind: 'num' | 'bool' | 'align' | 'color', value: unknown): string => {
    switch (kind) {
      case 'bool': return t(value ? 'designerValueOn' : 'designerValueOff');
      case 'align': return alignLabel(t, String(value));
      case 'color': return value ? String(value) : t('designerValueNone');
      default: return String(value);
    }
  };
  return (
    <AdvSection title={t('designerAdvStyle')} count={count}>
      {STYLE_ROWS.map(({ key, labelKey, kind }) => (
        <PropRow
          key={key}
          label={t(labelKey)}
          value={display(kind, style[key] ?? defaults[key])}
          overridden={style[key] !== undefined && style[key] !== defaults[key]}
          mono={kind === 'color' && !!style[key]}
        />
      ))}
    </AdvSection>
  );
}

/** "Layout in row" — share weight vs fixed-point width. */
function LayoutAdv({ element }: { element: ReportElementNode }) {
  const t = useDesignerT();
  const fixed = typeof element.width === 'number';
  const overridden = fixed || (element.weight !== undefined && element.weight !== 1);
  return (
    <AdvSection title={t('designerAdvLayout')} count={overridden ? 1 : 0}>
      <PropRow
        label={t('designerFieldWidth')}
        value={fixed
          ? t('designerWidthFixed', { width: element.width as number })
          : t('designerWidthShare', { weight: element.weight ?? 1 })}
        overridden={overridden}
      />
    </AdvSection>
  );
}

function VisibilityAdv({ element }: { element: ReportElementNode }) {
  const t = useDesignerT();
  const set = !!element.visibleIf;
  return (
    <AdvSection title={t('designerAdvVisibility')} count={set ? 1 : 0}>
      <PropRow
        label={t('designerFieldVisibleIf')}
        value={element.visibleIf ?? t('designerVisibilityAlways')}
        overridden={set}
        mono={set}
      />
      <NoteText>{t('designerVisibilityHelp')}</NoteText>
    </AdvSection>
  );
}

// ─── Report settings ────────────────────────────────────────────────────────

export function ReportSettingsBody({ doc, lang }: { doc: ReportDefinitionDoc; lang: DesignerLanguage }) {
  const t = useDesignerT();
  const page = asRecord(doc.page ?? {});
  const pageDefaults = ELEMENT_DEFAULTS.page as Record<string, unknown>;
  // Base font: an explicit document defaultStyle.fontSize counts as a change —
  // the default-elision convention means it would be omitted otherwise.
  const baseFontOverridden = doc.defaultStyle?.fontSize !== undefined;
  const pageCount = countChangedProps(page, pageDefaults, ['size', 'orientation', 'margin'])
    + (baseFontOverridden ? 1 : 0);
  const parameters = doc.parameters ?? [];
  const pageRow = (key: 'size' | 'orientation' | 'margin', labelKey: string) => (
    <PropRow
      label={t(labelKey)}
      value={String(page[key] ?? pageDefaults[key])}
      overridden={page[key] !== undefined && page[key] !== pageDefaults[key]}
    />
  );
  return (
    <>
      <PropRow stacked label={t('designerFieldReportTitle')} value={resolveLocalized(doc.title, lang) || '—'} />
      <PropRow label={t('designerFieldDataSource')} value={doc.dataSource ?? '—'} mono={!!doc.dataSource} />

      <AdvSection title={t('designerAdvPageSetup')} count={pageCount}>
        {pageRow('size', 'designerFieldPaperSize')}
        {pageRow('orientation', 'designerFieldOrientation')}
        {pageRow('margin', 'designerFieldMargin')}
        <PropRow
          label={t('designerFieldBaseFont')}
          value={String(doc.defaultStyle?.fontSize ?? ELEMENT_DEFAULTS.style.fontSize)}
          overridden={baseFontOverridden}
        />
      </AdvSection>

      <AdvSection
        title={t('designerAdvParameters')}
        count={parameters.length}
        badgeLabel={parameters.length > 0 ? t('designerParamsBadge', { count: parameters.length }) : undefined}
      >
        {parameters.length === 0 && <NoteText>—</NoteText>}
        {parameters.map((parameter) => (
          <Box key={parameter.name} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ fontSize: 12, fontFamily: MONO, color: INK, flexGrow: 1, wordBreak: 'break-all' }}>
              {parameter.name}
            </Typography>
            <Typography sx={{ fontSize: 10.5, fontFamily: MONO, color: MUTE, flexShrink: 0 }}>
              {parameter.type ?? 'string'}
            </Typography>
            <Typography sx={{ fontSize: 10, fontWeight: 700, color: parameter.required ? '#B45309' : MUTE, flexShrink: 0 }}>
              {t(parameter.required ? 'designerParamRequired' : 'designerParamOptional')}
            </Typography>
          </Box>
        ))}
        <NoteText>{t('designerParamsNote')}</NoteText>
      </AdvSection>

      <AdvSection title={t('designerAdvIdentity')} count={0}>
        <PropRow label={t('designerFieldKey')} value={doc.key} mono />
        <PropRow label={t('designerFieldVersion')} value={doc.version} mono />
        <PropRow
          label={t('designerFieldPermission')}
          value={doc.requiredPermission ?? '—'}
          mono={!!doc.requiredPermission}
        />
      </AdvSection>
    </>
  );
}

// ─── Sub-selections: table column / kv pair ─────────────────────────────────

export function TableColumnBody({ column, lang, fieldTypes }: {
  column: TableColumnNode;
  lang: DesignerLanguage;
  fieldTypes?: Map<string, string>;
}) {
  const t = useDesignerT();
  const alignOverridden = !!column.align && column.align !== 'left';
  const widthOverridden = column.width !== undefined || (column.weight !== undefined && column.weight !== 1);
  return (
    <>
      <PropRow stacked label={t('designerFieldHeader')} value={resolveLocalized(column.header, lang) || '—'} />
      <ValueSourceRow path={column.path} template={column.template} lang={lang} fieldTypes={fieldTypes} />
      {column.template == null && <FormatRow format={column.format} />}
      <AdvSection title={t('designerAdvColumnLayout')} count={(alignOverridden ? 1 : 0) + (widthOverridden ? 1 : 0)}>
        <PropRow
          label={t('designerFieldAlignment')}
          value={alignLabel(t, column.align ?? 'left')}
          overridden={alignOverridden}
        />
        <PropRow
          label={t('designerFieldWidth')}
          value={column.width !== undefined
            ? t('designerWidthFixed', { width: column.width })
            : t('designerWidthShare', { weight: column.weight ?? 1 })}
          overridden={widthOverridden}
        />
      </AdvSection>
    </>
  );
}

export function PairBody({ pair, lang, fieldTypes }: {
  pair: KeyValuePairNode;
  lang: DesignerLanguage;
  fieldTypes?: Map<string, string>;
}) {
  const t = useDesignerT();
  return (
    <>
      <PropRow stacked label={t('designerFieldLabel')} value={resolveLocalized(pair.label, lang) || '—'} />
      <ValueSourceRow path={pair.path} template={pair.template} lang={lang} fieldTypes={fieldTypes} />
      {pair.template == null && (
        <AdvSection title={t('designerAdvDisplay')} count={pair.format ? 1 : 0}>
          <FormatRow format={pair.format} />
        </AdvSection>
      )}
    </>
  );
}

// ─── Table helpers ──────────────────────────────────────────────────────────

export function TotalsList({ totals, columns, lang }: {
  totals: TableTotalNode[];
  columns: TableColumnNode[];
  lang: DesignerLanguage;
}) {
  const t = useDesignerT();
  if (totals.length === 0) {
    return <Typography sx={{ fontSize: 12, color: MUTE }}>—</Typography>;
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {totals.map((total, index) => {
        const column = columns.find((candidate) => candidate.id === total.columnId);
        const aggregate = total.aggregate === 'count' ? t('designerTotalCount') : t('designerTotalSum');
        return (
          <Box key={`${total.columnId}-${index}`} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ fontSize: 12, color: INK, flexGrow: 1, wordBreak: 'break-word' }}>
              {column ? (resolveLocalized(column.header, lang) || column.id) : total.columnId}
            </Typography>
            <Typography sx={{ fontSize: 10.5, fontFamily: MONO, color: MUTE, flexShrink: 0 }}>
              {aggregate + (total.format ? ` · ${total.format}` : '')}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

function TableBody({ element, lang }: { element: TableElementNode; lang: DesignerLanguage }) {
  const t = useDesignerT();
  const groupingCount =
    (element.groupBy ? 1 : 0) + (element.groupTotals?.length ?? 0) + (element.totals?.length ?? 0);
  const emptyPagingCount = (element.emptyText ? 1 : 0) + (element.repeatHeader === false ? 1 : 0);
  return (
    <>
      <PropRow label={t('designerFieldListSource')} value={element.bind} mono />
      <Box>
        <ListLabel>{t('designerFieldTableColumns', { count: element.columns.length })}</ListLabel>
        <ItemList items={element.columns.map((column) => ({
          id: column.id,
          primary: resolveLocalized(column.header, lang) || column.id,
          secondary: column.template != null ? t('designerValueKindTemplate') : (column.path ?? '—'),
        }))} />
      </Box>

      <AdvSection title={t('designerAdvGrouping')} count={groupingCount}>
        <PropRow
          label={t('designerFieldGroupBy')}
          value={element.groupBy ?? t('designerGroupingOff')}
          overridden={!!element.groupBy}
          mono={!!element.groupBy}
        />
        {element.groupBy && (
          <Box>
            <ListLabel>{t('designerFieldGroupTotals')}</ListLabel>
            <TotalsList totals={element.groupTotals ?? []} columns={element.columns} lang={lang} />
          </Box>
        )}
        <Box>
          <ListLabel>{t('designerFieldTotals')}</ListLabel>
          <TotalsList totals={element.totals ?? []} columns={element.columns} lang={lang} />
        </Box>
      </AdvSection>

      <AdvSection title={t('designerAdvEmptyPaging')} count={emptyPagingCount}>
        <PropRow
          stacked
          label={t('designerFieldEmptyTextList')}
          value={element.emptyText ? resolveLocalized(element.emptyText, lang) : '—'}
          overridden={!!element.emptyText}
        />
        <PropRow
          label={t('designerFieldRepeatHeader')}
          value={t(element.repeatHeader === false ? 'designerValueOff' : 'designerValueOn')}
          overridden={element.repeatHeader === false}
        />
      </AdvSection>

      <StyleAdv element={element} />
      <VisibilityAdv element={element} />
    </>
  );
}

// ─── Per-type element bodies ────────────────────────────────────────────────

export function ElementBody({ element, lang, fieldTypes }: {
  element: ReportElementNode;
  lang: DesignerLanguage;
  fieldTypes?: Map<string, string>;
}) {
  const t = useDesignerT();
  switch (element.type) {
    case 'text': {
      const localized = typeof element.text === 'object';
      return (
        <>
          <PropRow
            stacked
            label={localized
              ? t('designerFieldTextLang', { lang: lang.toUpperCase() })
              : t('designerFieldTextAll')}
            value={resolveLocalized(element.text, lang) || '—'}
          />
          <StyleAdv element={element} />
          <LayoutAdv element={element} />
          <VisibilityAdv element={element} />
        </>
      );
    }
    case 'field':
      return (
        <>
          <PropRow
            label={t('designerFieldDataField')}
            value={<>{element.path}{typeSuffix(fieldTypes, element.path)}</>}
            mono
          />
          <FormatRow format={element.format} />
          <AdvSection title={t('designerAdvEmptyState')} count={element.emptyText ? 1 : 0}>
            <PropRow
              stacked
              label={t('designerFieldEmptyTextValue')}
              value={element.emptyText ? resolveLocalized(element.emptyText, lang) : '—'}
              overridden={!!element.emptyText}
            />
          </AdvSection>
          <StyleAdv element={element} />
          <LayoutAdv element={element} />
          <VisibilityAdv element={element} />
        </>
      );
    case 'image':
      return (
        <>
          <PropRow label={t('designerFieldSource')} value={element.source ?? '—'} mono={!!element.source} />
          <NoteText>{t('designerImageSourceNote')}</NoteText>
          <PropRow
            label={t('designerFieldHeight')}
            value={String(element.height ?? ELEMENT_DEFAULTS.image.height)}
            overridden={element.height !== undefined && element.height !== ELEMENT_DEFAULTS.image.height}
          />
          <LayoutAdv element={element} />
          <VisibilityAdv element={element} />
        </>
      );
    case 'pageNumber':
      return (
        <>
          <PropRow
            label={t('designerFieldTemplate')}
            value={element.template ?? String(ELEMENT_DEFAULTS.pageNumber.template)}
            overridden={element.template !== undefined && element.template !== ELEMENT_DEFAULTS.pageNumber.template}
            mono
          />
          <NoteText>{t('designerPageNumberNote')}</NoteText>
          <StyleAdv element={element} />
          <LayoutAdv element={element} />
        </>
      );
    case 'container': {
      const half = element.width === 'half';
      return (
        <>
          <PropRow stacked label={t('designerFieldSectionTitle')} value={resolveLocalized(element.title, lang) || '—'} />
          <PropRow
            label={t('designerFieldWidth')}
            value={t(half ? 'designerWidthHalf' : 'designerWidthFull')}
            overridden={half}
          />
          {half && <NoteText>{t('designerContainerHalfNote')}</NoteText>}
          <StyleAdv element={element} />
          <VisibilityAdv element={element} />
        </>
      );
    }
    case 'keyValueGrid':
      return (
        <>
          <PropRow
            label={t('designerFieldColumns')}
            value={String(element.columns ?? ELEMENT_DEFAULTS.keyValueGrid.columns)}
            overridden={element.columns !== undefined && element.columns !== ELEMENT_DEFAULTS.keyValueGrid.columns}
          />
          <Box>
            <ListLabel>{t('designerFieldPairs', { count: element.pairs.length })}</ListLabel>
            <ItemList items={element.pairs.map((pair) => ({
              id: pair.id,
              primary: resolveLocalized(pair.label, lang) || pair.id,
              secondary: pair.template != null
                ? t('designerValueKindTemplate')
                : ((pair.path ?? '—').split('.').pop() ?? '—'),
            }))} />
          </Box>
          <VisibilityAdv element={element} />
        </>
      );
    case 'table':
      return <TableBody element={element} lang={lang} />;
    case 'row':
      return (
        <>
          <NoteText>{t('designerRowNote')}</NoteText>
          <StyleAdv element={element} />
          <VisibilityAdv element={element} />
        </>
      );
    case 'column':
      return (
        <>
          <PropRow
            label={t('designerFieldSpacing')}
            value={String(element.spacing ?? ELEMENT_DEFAULTS.column.spacing)}
            overridden={element.spacing !== undefined && element.spacing !== ELEMENT_DEFAULTS.column.spacing}
          />
          <StyleAdv element={element} />
          <VisibilityAdv element={element} />
        </>
      );
    case 'spacer':
      return (
        <>
          <PropRow
            label={t('designerFieldHeight')}
            value={String(element.height ?? ELEMENT_DEFAULTS.spacer.height)}
            overridden={element.height !== undefined && element.height !== ELEMENT_DEFAULTS.spacer.height}
          />
          <VisibilityAdv element={element} />
        </>
      );
    case 'line':
      return (
        <>
          <PropRow
            label={t('designerFieldThickness')}
            value={String(element.thickness ?? ELEMENT_DEFAULTS.line.thickness)}
            overridden={element.thickness !== undefined && element.thickness !== ELEMENT_DEFAULTS.line.thickness}
          />
          <PropRow
            label={t('designerFieldColor')}
            value={element.color ?? t('designerValueNone')}
            overridden={!!element.color}
            mono={!!element.color}
          />
          <VisibilityAdv element={element} />
        </>
      );
    default:
      return null;
  }
}
