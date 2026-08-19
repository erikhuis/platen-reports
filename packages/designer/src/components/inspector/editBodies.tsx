'use client';

/**
 * Editable per-type inspector bodies (tenant overlay + standard authoring).
 *
 * One `Edit*Body` per element type, plus the sub-selection bodies (table column,
 * key/value pair) and the `EditElementBody` dispatcher. Every control routes through
 * the `DesignerEditing` contract; structural fields sit behind `canEditStructureOf`
 * and fall back to a `LockedControl` when the standard owns them.
 *
 * Internal to `inspector/` — the folder's entry point is `DesignerInspector.tsx`.
 */

import { Box, MenuItem, Select, Typography } from '@mui/material';
import { useDesignerT } from '../../designerContext';
import {
  ELEMENT_DEFAULTS, resolveLocalized,
  type DesignerLanguage,
  type KeyValuePairNode,
  type LocalizedTextValue,
  type ReportDefinitionDoc,
  type ReportElementNode,
  type TableColumnNode,
  type TableElementNode,
} from '@platen-reports/model';
import type { ReportOverlayDoc } from '@platen-reports/model';
import type { DesignerEditing } from '@platen-reports/model';
import LangText from '../../LangText';
import { MONO_FONT as MONO } from '../designerConstants';
import {
  AddItemButton, AdvSection, EditColorInput, EditFieldRow, EditNumberInput, EditPathInput, EditSeg,
  EditTextInput, EditToggle, ItemList, ListLabel, LockedControl, NoteText, SLATE,
} from './primitives';
import { TotalsList } from './readOnlySections';
import {
  EditLayoutAdv, EditStyleAdv, EditTotalsEditor, EditValueSource, EditVisibilityAdv,
  addSubNode, canEditStructureOf,
} from './editSections';

function EditTextBody({ element, id, lang, editing }: {
  element: ReportElementNode; id: string; lang: DesignerLanguage; editing: DesignerEditing;
}) {
  const t = useDesignerT();
  const text = (element as { text?: LocalizedTextValue }).text;
  const localized = typeof text === 'object';
  return (
    <>
      <EditFieldRow
        label={localized ? t('designerFieldTextLang', { lang: lang.toUpperCase() }) : t('designerFieldTextAll')}
        touched={editing.touchedProps(id).has('text')}
        onReset={() => editing.resetProp(id, 'text')}
        defaultHint="—"
      >
        <LangText value={text} lang={lang} multiline onChange={(v) => editing.setProp(id, 'text', v, undefined)} /* no default: ELEMENT_DEFAULTS.text carries only `weight` */ />
      </EditFieldRow>
      <EditStyleAdv element={element} id={id} editing={editing} />
      <EditLayoutAdv element={element} id={id} editing={editing} />
      <EditVisibilityAdv element={element} id={id} editing={editing} />
    </>
  );
}

function EditFieldBody({ element, id, lang, editing, pathOptions }: {
  element: Extract<ReportElementNode, { type: 'field' }>; id: string; lang: DesignerLanguage; editing: DesignerEditing;
  pathOptions?: string[];
}) {
  const t = useDesignerT();
  const insert = editing.isOverlayInsert(id);
  const canEdit = canEditStructureOf(editing, id);
  const pathControl = (
    <EditPathInput value={element.path ?? ''} options={pathOptions} onChange={(v) => editing.setProp(id, 'path', v, undefined)} />
  );
  return (
    <>
      <EditFieldRow
        label={t('designerFieldDataField')}
        touched={insert && editing.touchedProps(id).has('path')}
        onReset={insert ? () => editing.resetProp(id, 'path') : undefined}
      >
        {canEdit ? pathControl : <LockedControl note={t('designerLockFieldPath')}>{pathControl}</LockedControl>}
      </EditFieldRow>
      <EditFieldRow
        inline
        label={t('designerFieldFormat')}
        touched={editing.touchedProps(id).has('format')}
        onReset={() => editing.resetProp(id, 'format')}
        defaultHint={t('designerValueDefaultFormat')}
      >
        <EditTextInput mono value={element.format ?? ''} onChange={(v) => editing.setProp(id, 'format', v || undefined, '')} />
      </EditFieldRow>
      <AdvSection title={t('designerAdvEmptyState')} count={element.emptyText ? 1 : 0}>
        <EditFieldRow
          label={t('designerFieldEmptyTextValue')}
          touched={editing.touchedProps(id).has('emptyText')}
          onReset={() => editing.resetProp(id, 'emptyText')}
          defaultHint="—"
        >
          <LangText value={element.emptyText} lang={lang} onChange={(v) => editing.setProp(id, 'emptyText', v, undefined)} />
        </EditFieldRow>
      </AdvSection>
      <EditStyleAdv element={element} id={id} editing={editing} />
      <EditLayoutAdv element={element} id={id} editing={editing} />
      <EditVisibilityAdv element={element} id={id} editing={editing} />
    </>
  );
}

function EditImageBody({ element, id, editing }: {
  element: Extract<ReportElementNode, { type: 'image' }>; id: string; editing: DesignerEditing;
}) {
  const t = useDesignerT();
  // Editable when the structure is unlocked: tenant inserts (tenant mode) OR any element in
  // standard authoring. The standard owns a pre-existing image's source only in tenant mode.
  const canEditSource = canEditStructureOf(editing, id);
  // Editable images: source is a fixed choice — the renderer only supports 'tenantLogo'.
  // A single-option Select signals that constraint instead of inviting a free-text value.
  const sourceSelect = (
    <Select
      size="small"
      fullWidth
      value={element.source ?? 'tenantLogo'}
      onChange={(e) => editing.setProp(id, 'source', e.target.value, undefined)}
      data-testid="image-source-select"
      sx={{ '& .MuiSelect-select': { fontSize: 12, fontFamily: MONO } }}
    >
      <MenuItem value="tenantLogo">{t('designerImageSourceTenantLogo')}</MenuItem>
    </Select>
  );
  // Standard (non-inserted) images stay locked read-only — the source is owned by the standard.
  const lockedSource = (
    <LockedControl>
      <EditTextInput mono value={element.source ?? ''} onChange={() => {}} />
    </LockedControl>
  );
  const heightDefault = ELEMENT_DEFAULTS.image.height as number;
  return (
    <>
      <EditFieldRow label={t('designerFieldSource')} touched={false}>
        {canEditSource ? sourceSelect : lockedSource}
      </EditFieldRow>
      <NoteText>{t('designerImageSourceNote')}</NoteText>
      <EditFieldRow
        inline
        label={t('designerFieldHeight')}
        touched={editing.touchedProps(id).has('height')}
        onReset={() => editing.resetProp(id, 'height')}
        defaultHint={String(heightDefault)}
      >
        <EditNumberInput value={element.height ?? heightDefault} onChange={(v) => editing.setProp(id, 'height', v, heightDefault)} />
      </EditFieldRow>
      <EditLayoutAdv element={element} id={id} editing={editing} />
      <EditVisibilityAdv element={element} id={id} editing={editing} />
    </>
  );
}

function EditPageNumberBody({ element, id, editing }: {
  element: Extract<ReportElementNode, { type: 'pageNumber' }>; id: string; editing: DesignerEditing;
}) {
  const t = useDesignerT();
  const templateDefault = ELEMENT_DEFAULTS.pageNumber.template as string;
  return (
    <>
      <EditFieldRow
        label={t('designerFieldTemplate')}
        touched={editing.touchedProps(id).has('template')}
        onReset={() => editing.resetProp(id, 'template')}
        defaultHint={templateDefault}
      >
        <EditTextInput mono value={element.template ?? templateDefault} onChange={(v) => editing.setProp(id, 'template', v, templateDefault)} />
      </EditFieldRow>
      <NoteText>{t('designerPageNumberNote')}</NoteText>
      <EditStyleAdv element={element} id={id} editing={editing} />
      <EditLayoutAdv element={element} id={id} editing={editing} />
    </>
  );
}

function EditContainerBody({ element, id, lang, editing }: {
  element: Extract<ReportElementNode, { type: 'container' }>; id: string; lang: DesignerLanguage; editing: DesignerEditing;
}) {
  const t = useDesignerT();
  const half = element.width === 'half';
  const widthDefault = ELEMENT_DEFAULTS.container.width;
  return (
    <>
      <EditFieldRow
        label={t('designerFieldSectionTitle')}
        touched={editing.touchedProps(id).has('title')}
        onReset={() => editing.resetProp(id, 'title')}
        defaultHint="—"
      >
        <LangText value={element.title} lang={lang} onChange={(v) => editing.setProp(id, 'title', v, undefined)} />
      </EditFieldRow>
      <EditFieldRow
        label={t('designerFieldWidth')}
        touched={editing.touchedProps(id).has('width')}
        onReset={() => editing.resetProp(id, 'width')}
        defaultHint={t('designerWidthFull')}
      >
        <EditSeg
          value={half ? 'half' : 'full'}
          onChange={(v) => editing.setProp(id, 'width', v, widthDefault)}
          options={[{ value: 'full', label: t('designerWidthFull') }, { value: 'half', label: t('designerWidthHalf') }]}
        />
      </EditFieldRow>
      {half && <NoteText>{t('designerContainerHalfNote')}</NoteText>}
      <EditStyleAdv element={element} id={id} editing={editing} />
      <EditVisibilityAdv element={element} id={id} editing={editing} />
    </>
  );
}

function EditKvGridBody({ element, id, lang, editing, doc, overlay, onSelect }: {
  element: Extract<ReportElementNode, { type: 'keyValueGrid' }>; id: string; lang: DesignerLanguage; editing: DesignerEditing;
  doc: ReportDefinitionDoc; overlay?: ReportOverlayDoc; onSelect?: (id: string) => void;
}) {
  const t = useDesignerT();
  const insert = editing.isOverlayInsert(id);
  const canEdit = canEditStructureOf(editing, id);
  const columnsDefault = ELEMENT_DEFAULTS.keyValueGrid.columns as number;
  const addField = () => addSubNode({
    editing, doc, overlay, ownerId: id, prefix: 'kvp',
    existingIds: element.pairs.map((p) => p.id),
    build: (fieldId) => ({ id: fieldId, label: { en: 'Label' }, path: '' }),
    onSelect,
  });
  const columnsSeg = (
    <EditSeg
      value={element.columns ?? columnsDefault}
      onChange={(v) => editing.setProp(id, 'columns', v, columnsDefault)}
      options={[{ value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' }]}
    />
  );
  return (
    <>
      <EditFieldRow
        label={t('designerFieldColumns')}
        touched={insert && editing.touchedProps(id).has('columns')}
        onReset={insert ? () => editing.resetProp(id, 'columns') : undefined}
      >
        {canEdit ? columnsSeg : <LockedControl>{columnsSeg}</LockedControl>}
      </EditFieldRow>
      <Box>
        <ListLabel>{t('designerFieldPairs', { count: element.pairs.length })}</ListLabel>
        <ItemList items={element.pairs.map((pair) => ({
          id: pair.id,
          primary: resolveLocalized(pair.label, lang) || pair.id,
          secondary: pair.template != null ? t('designerValueKindTemplate') : ((pair.path ?? '—').split('.').pop() ?? '—'),
        }))} />
        <AddItemButton label={t('designerAddField')} testId="add-field-button" onClick={addField} />
      </Box>
      <EditVisibilityAdv element={element} id={id} editing={editing} />
    </>
  );
}

function EditTableBody({ element, id, lang, editing, doc, overlay, onSelect, pathOptions }: {
  element: TableElementNode; id: string; lang: DesignerLanguage; editing: DesignerEditing;
  doc: ReportDefinitionDoc; overlay?: ReportOverlayDoc; onSelect?: (id: string) => void; pathOptions?: string[];
}) {
  const t = useDesignerT();
  const insert = editing.isOverlayInsert(id);
  const canEdit = canEditStructureOf(editing, id);
  const bindControl = (
    <EditPathInput value={element.bind} options={pathOptions} onChange={(v) => editing.setProp(id, 'bind', v, undefined)} />
  );
  const groupingCount = (element.groupBy ? 1 : 0) + (element.groupTotals?.length ?? 0) + (element.totals?.length ?? 0);
  const emptyPagingCount = (element.emptyText ? 1 : 0) + (element.repeatHeader === false ? 1 : 0);
  const addColumn = () => addSubNode({
    editing, doc, overlay, ownerId: id, prefix: 'col',
    existingIds: element.columns.map((c) => c.id),
    build: (colId) => ({ id: colId, header: { en: 'Column' }, path: '' }),
    onSelect,
  });
  return (
    <>
      <EditFieldRow label={t('designerFieldListSource')} touched={insert && editing.touchedProps(id).has('bind')} onReset={insert ? () => editing.resetProp(id, 'bind') : undefined}>
        {canEdit ? bindControl : <LockedControl>{bindControl}</LockedControl>}
      </EditFieldRow>
      <Box>
        <ListLabel>{t('designerFieldTableColumns', { count: element.columns.length })}</ListLabel>
        <ItemList items={element.columns.map((column) => ({
          id: column.id,
          primary: resolveLocalized(column.header, lang) || column.id,
          secondary: column.template != null ? t('designerValueKindTemplate') : (column.path ?? '—'),
        }))} />
        <AddItemButton label={t('designerAddColumn')} testId="add-column-button" onClick={addColumn} />
      </Box>

      <AdvSection title={t('designerAdvGrouping')} count={groupingCount}>
        <EditFieldRow
          inline
          label={t('designerFieldGroupBy')}
          touched={editing.touchedProps(id).has('groupBy')}
          onReset={() => editing.resetProp(id, 'groupBy')}
          defaultHint={t('designerGroupingOff')}
        >
          <EditPathInput value={element.groupBy ?? ''} options={pathOptions} onChange={(v) => editing.setProp(id, 'groupBy', v || undefined, undefined)} />
        </EditFieldRow>
        {element.groupBy && (
          <Box>
            <ListLabel>{t('designerFieldGroupTotals')}</ListLabel>
            {canEdit ? (
              <EditTotalsEditor
                list={element.groupTotals ?? []}
                columns={element.columns}
                id={id}
                prop="groupTotals"
                editing={editing}
                lang={lang}
                addTestId="add-grouptotal-button"
              />
            ) : (
              <LockedControl note={t('designerLockTotals')}>
                <TotalsList totals={element.groupTotals ?? []} columns={element.columns} lang={lang} />
              </LockedControl>
            )}
          </Box>
        )}
        <Box>
          <ListLabel>{t('designerFieldTotals')}</ListLabel>
          {canEdit ? (
            <EditTotalsEditor
              list={element.totals ?? []}
              columns={element.columns}
              id={id}
              prop="totals"
              editing={editing}
              lang={lang}
              addTestId="add-total-button"
            />
          ) : (
            <LockedControl note={t('designerLockTotals')}>
              <TotalsList totals={element.totals ?? []} columns={element.columns} lang={lang} />
            </LockedControl>
          )}
        </Box>
      </AdvSection>

      <AdvSection title={t('designerAdvEmptyPaging')} count={emptyPagingCount}>
        <EditFieldRow
          label={t('designerFieldEmptyTextList')}
          touched={editing.touchedProps(id).has('emptyText')}
          onReset={() => editing.resetProp(id, 'emptyText')}
          defaultHint="—"
        >
          <LangText value={element.emptyText} lang={lang} onChange={(v) => editing.setProp(id, 'emptyText', v, undefined)} />
        </EditFieldRow>
        <EditFieldRow
          inline
          label={t('designerFieldRepeatHeader')}
          touched={editing.touchedProps(id).has('repeatHeader')}
          onReset={() => editing.resetProp(id, 'repeatHeader')}
          defaultHint={t('designerValueOn')}
        >
          <EditToggle value={element.repeatHeader !== false} onChange={(v) => editing.setProp(id, 'repeatHeader', v ? undefined : false, ELEMENT_DEFAULTS.table.repeatHeader)} />
        </EditFieldRow>
      </AdvSection>

      <EditStyleAdv element={element} id={id} editing={editing} />
      <EditVisibilityAdv element={element} id={id} editing={editing} />
    </>
  );
}

function EditRowBody({ element, id, editing }: { element: ReportElementNode; id: string; editing: DesignerEditing }) {
  const t = useDesignerT();
  return (
    <>
      <NoteText>{t('designerRowNote')}</NoteText>
      <EditStyleAdv element={element} id={id} editing={editing} />
      <EditVisibilityAdv element={element} id={id} editing={editing} />
    </>
  );
}

function EditColumnBody({ element, id, editing }: {
  element: Extract<ReportElementNode, { type: 'column' }>; id: string; editing: DesignerEditing;
}) {
  const t = useDesignerT();
  const spacingDefault = ELEMENT_DEFAULTS.column.spacing as number;
  return (
    <>
      <EditFieldRow
        inline
        label={t('designerFieldSpacing')}
        touched={editing.touchedProps(id).has('spacing')}
        onReset={() => editing.resetProp(id, 'spacing')}
        defaultHint={String(spacingDefault)}
      >
        <EditNumberInput value={element.spacing ?? spacingDefault} onChange={(v) => editing.setProp(id, 'spacing', v, spacingDefault)} />
      </EditFieldRow>
      <EditStyleAdv element={element} id={id} editing={editing} />
      <EditVisibilityAdv element={element} id={id} editing={editing} />
    </>
  );
}

function EditSpacerBody({ element, id, editing }: {
  element: Extract<ReportElementNode, { type: 'spacer' }>; id: string; editing: DesignerEditing;
}) {
  const t = useDesignerT();
  const heightDefault = ELEMENT_DEFAULTS.spacer.height as number;
  return (
    <>
      <EditFieldRow
        inline
        label={t('designerFieldHeight')}
        touched={editing.touchedProps(id).has('height')}
        onReset={() => editing.resetProp(id, 'height')}
        defaultHint={String(heightDefault)}
      >
        <EditNumberInput value={element.height ?? heightDefault} onChange={(v) => editing.setProp(id, 'height', v, heightDefault)} />
      </EditFieldRow>
      <EditVisibilityAdv element={element} id={id} editing={editing} />
    </>
  );
}

function EditLineBody({ element, id, editing }: {
  element: Extract<ReportElementNode, { type: 'line' }>; id: string; editing: DesignerEditing;
}) {
  const t = useDesignerT();
  const thicknessDefault = ELEMENT_DEFAULTS.line.thickness as number;
  return (
    <>
      <EditFieldRow
        inline
        label={t('designerFieldThickness')}
        touched={editing.touchedProps(id).has('thickness')}
        onReset={() => editing.resetProp(id, 'thickness')}
        defaultHint={String(thicknessDefault)}
      >
        <EditNumberInput value={element.thickness ?? thicknessDefault} step={0.5} onChange={(v) => editing.setProp(id, 'thickness', v, thicknessDefault)} />
      </EditFieldRow>
      <EditFieldRow
        label={t('designerFieldColor')}
        touched={editing.touchedProps(id).has('color')}
        onReset={() => editing.resetProp(id, 'color')}
        defaultHint={t('designerColorDefault')}
      >
        <EditColorInput value={element.color} onChange={(v) => editing.setProp(id, 'color', v ?? '', '')} />
      </EditFieldRow>
      <EditVisibilityAdv element={element} id={id} editing={editing} />
    </>
  );
}

export function EditTableColumnBody({ column, id, lang, editing, pathOptions }: {
  column: TableColumnNode; id: string; lang: DesignerLanguage; editing: DesignerEditing; pathOptions?: string[];
}) {
  const t = useDesignerT();
  const isTemplate = column.template != null;
  return (
    <>
      <EditFieldRow
        label={t('designerFieldHeader')}
        touched={editing.touchedProps(id).has('header')}
        onReset={() => editing.resetProp(id, 'header')}
        defaultHint="—"
      >
        <LangText value={column.header} lang={lang} onChange={(v) => editing.setProp(id, 'header', v, undefined)} />
      </EditFieldRow>
      <Box>
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: SLATE, mb: 0.5 }}>{t('designerFieldValue')}</Typography>
        <EditValueSource node={column} id={id} lang={lang} editing={editing} pathOptions={pathOptions} />
      </Box>
      {!isTemplate && (
        <EditFieldRow
          inline
          label={t('designerFieldFormat')}
          touched={editing.touchedProps(id).has('format')}
          onReset={() => editing.resetProp(id, 'format')}
          defaultHint={t('designerValueDefaultFormat')}
        >
          <EditTextInput mono value={column.format ?? ''} onChange={(v) => editing.setProp(id, 'format', v || undefined, '')} />
        </EditFieldRow>
      )}
      <AdvSection
        title={t('designerAdvColumnLayout')}
        count={(column.align && column.align !== 'left' ? 1 : 0) + (column.width !== undefined || (column.weight !== undefined && column.weight !== 1) ? 1 : 0)}
      >
        <EditFieldRow
          label={t('designerFieldAlignment')}
          touched={editing.touchedProps(id).has('align')}
          onReset={() => editing.resetProp(id, 'align')}
          defaultHint={t('designerAlignLeft')}
        >
          <EditSeg
            value={column.align ?? 'left'}
            onChange={(v) => editing.setProp(id, 'align', v, 'left')}
            options={[
              { value: 'left', label: t('designerAlignLeft') },
              { value: 'center', label: t('designerAlignCenter') },
              { value: 'right', label: t('designerAlignRight') },
            ]}
          />
        </EditFieldRow>
        <EditFieldRow
          label={t('designerFieldWidth')}
          touched={editing.touchedProps(id).has('width') || editing.touchedProps(id).has('weight')}
          onReset={() => { editing.resetProp(id, 'width'); editing.resetProp(id, 'weight'); }}
          defaultHint={t('designerWidthShare', { weight: 1 })}
        >
          <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
            <EditSeg
              value={column.width !== undefined ? 'fixed' : 'share'}
              onChange={(v) => {
                if (v === 'fixed') { editing.setProp(id, 'weight', undefined, 1); editing.setProp(id, 'width', 60, undefined); }
                else { editing.setProp(id, 'width', undefined, undefined); }
              }}
              options={[{ value: 'share', label: t('designerSegShare') }, { value: 'fixed', label: t('designerSegFixed') }]}
            />
            {column.width !== undefined
              ? <EditNumberInput value={column.width} onChange={(v) => editing.setProp(id, 'width', v, undefined)} />
              : <EditNumberInput value={column.weight ?? 1} step={0.5} onChange={(v) => editing.setProp(id, 'weight', v, 1)} />}
          </Box>
        </EditFieldRow>
      </AdvSection>
    </>
  );
}

export function EditPairBody({ pair, id, lang, editing, pathOptions }: {
  pair: KeyValuePairNode; id: string; lang: DesignerLanguage; editing: DesignerEditing; pathOptions?: string[];
}) {
  const t = useDesignerT();
  const isTemplate = pair.template != null;
  return (
    <>
      <EditFieldRow
        label={t('designerFieldLabel')}
        touched={editing.touchedProps(id).has('label')}
        onReset={() => editing.resetProp(id, 'label')}
        defaultHint="—"
      >
        <LangText value={pair.label} lang={lang} onChange={(v) => editing.setProp(id, 'label', v, undefined)} />
      </EditFieldRow>
      <Box>
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: SLATE, mb: 0.5 }}>{t('designerFieldValue')}</Typography>
        <EditValueSource node={pair} id={id} lang={lang} editing={editing} pathOptions={pathOptions} />
      </Box>
      {!isTemplate && (
        <AdvSection title={t('designerAdvDisplay')} count={pair.format ? 1 : 0}>
          <EditFieldRow
            inline
            label={t('designerFieldFormat')}
            touched={editing.touchedProps(id).has('format')}
            onReset={() => editing.resetProp(id, 'format')}
            defaultHint={t('designerValueDefaultFormat')}
          >
            <EditTextInput mono value={pair.format ?? ''} onChange={(v) => editing.setProp(id, 'format', v || undefined, '')} />
          </EditFieldRow>
        </AdvSection>
      )}
    </>
  );
}

/** Dispatch an editable element body by type. */
export function EditElementBody({ element, id, lang, editing, doc, overlay, onSelect, pathOptions }: {
  element: ReportElementNode; id: string; lang: DesignerLanguage; editing: DesignerEditing;
  doc: ReportDefinitionDoc; overlay?: ReportOverlayDoc; onSelect?: (id: string) => void; pathOptions?: string[];
}) {
  switch (element.type) {
    case 'text': return <EditTextBody element={element} id={id} lang={lang} editing={editing} />;
    case 'field': return <EditFieldBody element={element} id={id} lang={lang} editing={editing} pathOptions={pathOptions} />;
    case 'image': return <EditImageBody element={element} id={id} editing={editing} />;
    case 'pageNumber': return <EditPageNumberBody element={element} id={id} editing={editing} />;
    case 'container': return <EditContainerBody element={element} id={id} lang={lang} editing={editing} />;
    case 'keyValueGrid': return <EditKvGridBody element={element} id={id} lang={lang} editing={editing} doc={doc} overlay={overlay} onSelect={onSelect} />;
    case 'table': return <EditTableBody element={element} id={id} lang={lang} editing={editing} doc={doc} overlay={overlay} onSelect={onSelect} pathOptions={pathOptions} />;
    case 'row': return <EditRowBody element={element} id={id} editing={editing} />;
    case 'column': return <EditColumnBody element={element} id={id} editing={editing} />;
    case 'spacer': return <EditSpacerBody element={element} id={id} editing={editing} />;
    case 'line': return <EditLineBody element={element} id={id} editing={editing} />;
    default: return null;
  }
}
