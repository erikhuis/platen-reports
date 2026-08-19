'use client';

/**
 * Editable shared sections (tenant overlay + standard authoring).
 *
 * Rendered only when a `DesignerEditing` contract is threaded in. Allowlisted props
 * (overlayModel.isAllowedSetProp) become inputs that compile to setProps ops (or, for
 * tenant inserts, direct payload edits). Non-allowlisted structure is locked at 55%
 * opacity with a lock note; a tenant insert unlocks its own structural fields.
 *
 * Internal to `inspector/` — the folder's entry point is `DesignerInspector.tsx`.
 */

import { Box, IconButton, MenuItem, Select, TextField } from '@mui/material';
import { Trash2 } from 'lucide-react';
import { useDesignerT } from '../../designerContext';
import {
  ELEMENT_DEFAULTS, countChangedProps, resolveLocalized,
  type DesignerLanguage,
  type KeyValuePairNode,
  type ReportDefinitionDoc,
  type ReportElementNode,
  type TableColumnNode,
  type TableTotalNode,
} from '@platen-reports/model';
import { collectAllIds, nextId, type ReportOverlayDoc } from '@platen-reports/model';
import type { DesignerEditing, InsertTarget } from '@platen-reports/model';
import { MONO_FONT as MONO } from '../designerConstants';
import {
  AddItemButton, AdvSection, EditColorInput, EditFieldRow, EditNumberInput, EditPathInput, EditSeg,
  EditTextInput, EditToggle, LockedControl, MUTE, NoteText, STYLE_KEYS, asRecord,
} from './primitives';

/**
 * Whether STRUCTURAL fields (table bind, field/value path, totals editors, keyValueGrid
 * columns) are editable for this id. Standard mode: `canEditStructure` is always true.
 * Tenant mode: no `canEditStructure` is threaded, so we fall back to the tenant-insert
 * rule (only tenant inserts unlock their own structure). See DesignerEditing.
 */
export function canEditStructureOf(editing: DesignerEditing, id: string): boolean {
  return (editing.canEditStructure ?? editing.isOverlayInsert)(id);
}

// ─── Editable shared Advanced sections ──────────────────────────────────────

export function EditStyleAdv({ element, id, editing }: { element: ReportElementNode; id: string; editing: DesignerEditing }) {
  const t = useDesignerT();
  const style = asRecord(element.style ?? {});
  // Indexed by a runtime key from STYLE_KEYS/STYLE_ROWS, so widen once here rather than
  // casting at each use. ELEMENT_DEFAULTS keeps its literal keys for everyone else.
  const defaults = ELEMENT_DEFAULTS.style as Record<string, unknown>;
  const count = countChangedProps(style, defaults, STYLE_KEYS);
  const touched = (key: string) => editing.touchedProps(id).has(`style.${key}`);
  const set = (key: string, value: unknown) => editing.setProp(id, `style.${key}`, value, defaults[key]);
  const reset = (key: string) => editing.resetProp(id, `style.${key}`);
  const num = (key: string, labelKey: string, step = 1) => (
    <EditFieldRow key={key} inline label={t(labelKey)} touched={touched(key)} onReset={() => reset(key)} defaultHint={String(defaults[key])}>
      <EditNumberInput value={(style[key] as number | undefined) ?? (defaults[key] as number)} step={step} onChange={(v) => set(key, v)} />
    </EditFieldRow>
  );
  const color = (key: string, labelKey: string) => (
    <EditFieldRow key={key} label={t(labelKey)} touched={touched(key)} onReset={() => reset(key)} defaultHint={t('designerColorDefault')}>
      <EditColorInput value={style[key] as string | undefined} onChange={(v) => set(key, v ?? '')} />
    </EditFieldRow>
  );
  return (
    <AdvSection title={t('designerAdvStyle')} count={count}>
      {num('fontSize', 'designerStyleFontSize')}
      <EditFieldRow inline label={t('designerStyleBold')} touched={touched('bold')} onReset={() => reset('bold')} defaultHint={t('designerValueOff')}>
        <EditToggle value={!!style.bold} onChange={(v) => set('bold', v)} />
      </EditFieldRow>
      <EditFieldRow inline label={t('designerStyleItalic')} touched={touched('italic')} onReset={() => reset('italic')} defaultHint={t('designerValueOff')}>
        <EditToggle value={!!style.italic} onChange={(v) => set('italic', v)} />
      </EditFieldRow>
      <EditFieldRow label={t('designerStyleAlign')} touched={touched('align')} onReset={() => reset('align')} defaultHint={t('designerAlignLeft')}>
        <EditSeg
          value={(style.align as string) ?? 'left'}
          onChange={(v) => set('align', v)}
          options={[
            { value: 'left', label: t('designerAlignLeft') },
            { value: 'center', label: t('designerAlignCenter') },
            { value: 'right', label: t('designerAlignRight') },
          ]}
        />
      </EditFieldRow>
      {color('color', 'designerStyleColor')}
      {color('backgroundColor', 'designerStyleBackgroundColor')}
      {num('paddingTop', 'designerStylePaddingTop')}
      {num('paddingBottom', 'designerStylePaddingBottom')}
      {num('paddingLeft', 'designerStylePaddingLeft')}
      {num('paddingRight', 'designerStylePaddingRight')}
      {num('borderTop', 'designerStyleBorderTop', 0.5)}
      {num('borderBottom', 'designerStyleBorderBottom', 0.5)}
      {num('borderLeft', 'designerStyleBorderLeft', 0.5)}
      {num('borderRight', 'designerStyleBorderRight', 0.5)}
      {color('borderColor', 'designerStyleBorderColor')}
    </AdvSection>
  );
}

/** "Layout in row" — share (weight) vs fixed-point (width); both allowlisted. */
export function EditLayoutAdv({ element, id, editing }: { element: ReportElementNode; id: string; editing: DesignerEditing }) {
  const t = useDesignerT();
  const fixed = typeof element.width === 'number';
  const overridden = fixed || (element.weight !== undefined && element.weight !== 1);
  const touched = editing.touchedProps(id).has('width') || editing.touchedProps(id).has('weight');
  const reset = () => { editing.resetProp(id, 'width'); editing.resetProp(id, 'weight'); };
  return (
    <AdvSection title={t('designerAdvLayout')} count={overridden ? 1 : 0}>
      <EditFieldRow label={t('designerFieldWidth')} touched={touched} onReset={reset} defaultHint={t('designerWidthShare', { weight: 1 })}>
        <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
          <EditSeg
            value={fixed ? 'fixed' : 'share'}
            onChange={(v) => {
              if (v === 'fixed') { editing.setProp(id, 'weight', undefined, 1); editing.setProp(id, 'width', 120, undefined); }
              else { editing.setProp(id, 'width', undefined, undefined); }
            }}
            options={[{ value: 'share', label: t('designerSegShare') }, { value: 'fixed', label: t('designerSegFixed') }]}
          />
          {fixed
            ? <EditNumberInput value={element.width as number} onChange={(v) => editing.setProp(id, 'width', v, undefined)} />
            : <EditNumberInput value={element.weight ?? 1} step={0.5} onChange={(v) => editing.setProp(id, 'weight', v, 1)} />}
        </Box>
      </EditFieldRow>
    </AdvSection>
  );
}

export function EditVisibilityAdv({ element, id, editing }: { element: ReportElementNode; id: string; editing: DesignerEditing }) {
  const t = useDesignerT();
  const set = !!element.visibleIf;
  return (
    <AdvSection title={t('designerAdvVisibility')} count={set ? 1 : 0}>
      <EditFieldRow
        label={t('designerFieldVisibleIf')}
        touched={editing.touchedProps(id).has('visibleIf')}
        onReset={() => editing.resetProp(id, 'visibleIf')}
        defaultHint={t('designerVisibilityAlways')}
      >
        <EditTextInput
          mono
          value={element.visibleIf ?? ''}
          placeholder={t('designerVisibleIfPlaceholder')}
          onChange={(v) => editing.setProp(id, 'visibleIf', v || undefined, undefined)}
        />
      </EditFieldRow>
      <NoteText>{t('designerVisibleIfHelp')}</NoteText>
    </AdvSection>
  );
}

/**
 * Field | Template value source; the bound path is locked on standard elements in
 * tenant mode, and unlocked in standard mode (`canEditStructure`).
 */
export function EditValueSource({ node, id, lang, editing, pathOptions }: {
  node: TableColumnNode | KeyValuePairNode;
  id: string;
  lang: DesignerLanguage;
  editing: DesignerEditing;
  pathOptions?: string[];
}) {
  const t = useDesignerT();
  const canEdit = canEditStructureOf(editing, id);
  const isTemplate = node.template != null;
  if (isTemplate) {
    // Template text is allowlisted → editable even on standard elements.
    return (
      <EditTextInput
        mono
        value={typeof node.template === 'string' ? node.template : resolveLocalized(node.template, lang)}
        onChange={(v) => editing.setProp(id, 'template', v, undefined)}
      />
    );
  }
  const pathControl = (
    <EditPathInput value={node.path ?? ''} options={pathOptions} onChange={(v) => editing.setProp(id, 'path', v, undefined)} />
  );
  return canEdit ? pathControl : <LockedControl note={t('designerLockFieldPath')}>{pathControl}</LockedControl>;
}

/**
 * Standard-mode editor for a table's `totals[]` / `groupTotals[]`: each entry is a
 * column select + Sum/Count seg + optional format + remove; an "Add total" pill
 * appends a new entry. Committed as a direct doc edit through `setProp` (empty list
 * elides the property). Rendered only behind the `canEditStructure` gate — tenant
 * mode keeps the locked read-only `TotalsList`.
 */
export function EditTotalsEditor({ list, columns, id, prop, editing, lang, addTestId }: {
  list: TableTotalNode[];
  columns: TableColumnNode[];
  id: string;
  prop: 'totals' | 'groupTotals';
  editing: DesignerEditing;
  lang: DesignerLanguage;
  addTestId: string;
}) {
  const t = useDesignerT();
  const commit = (next: TableTotalNode[]) => editing.setProp(id, prop, next.length ? next : undefined, undefined);
  const update = (index: number, patch: Partial<TableTotalNode>) =>
    commit(list.map((total, i) => (i === index ? { ...total, ...patch } : total)));
  const remove = (index: number) => commit(list.filter((_, i) => i !== index));
  const add = () => commit([...list, { columnId: columns[0]?.id ?? '', aggregate: 'sum' }]);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      {list.map((total, index) => (
        <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Select
            size="small"
            value={total.columnId}
            onChange={(e) => update(index, { columnId: e.target.value })}
            inputProps={{ 'aria-label': t('designerTotalColumn') }}
            sx={{ flexGrow: 1, minWidth: 0, '& .MuiSelect-select': { fontSize: 12, py: 0.5 } }}
          >
            {columns.map((column) => (
              <MenuItem key={column.id} value={column.id} sx={{ fontSize: 12 }}>
                {resolveLocalized(column.header, lang) || column.id}
              </MenuItem>
            ))}
          </Select>
          <EditSeg
            value={total.aggregate === 'count' ? 'count' : 'sum'}
            onChange={(v) => update(index, { aggregate: String(v) })}
            options={[{ value: 'sum', label: t('designerTotalSum') }, { value: 'count', label: t('designerTotalCount') }]}
          />
          <TextField
            size="small"
            value={total.format ?? ''}
            placeholder={t('designerFieldFormat')}
            onChange={(e) => update(index, { format: e.target.value || undefined })}
            sx={{ width: 62 }}
            inputProps={{ style: { fontFamily: MONO, fontSize: 11 }, 'aria-label': t('designerFieldFormat') }}
          />
          <IconButton size="small" aria-label={t('designerRemoveTotal')} onClick={() => remove(index)} sx={{ p: 0.25, color: MUTE }}>
            <Trash2 size={13} />
          </IconButton>
        </Box>
      ))}
      <AddItemButton label={t('designerAddTotal')} testId={addTestId} onClick={add} />
    </Box>
  );
}

/**
 * Insert a fresh sub-node (table column or grid pair) as a tenant insert, then select it.
 * Anchors `after` the last existing sub-node; falls back to `appendInto` the owner when the
 * list is empty (server-parity target). `section` is only consulted for the pageNumber
 * palette lock, so a column/pair insert can safely pass 'body'.
 */
export function addSubNode(args: {
  editing: DesignerEditing;
  doc: ReportDefinitionDoc;
  overlay: ReportOverlayDoc | undefined;
  ownerId: string;
  existingIds: string[];
  prefix: string;
  build: (id: string) => Record<string, unknown>;
  onSelect?: (id: string) => void;
}): void {
  const { editing, doc, overlay, ownerId, existingIds, prefix, build, onSelect } = args;
  const newId = nextId(prefix, collectAllIds(doc, overlay ?? {}));
  const last = existingIds[existingIds.length - 1];
  const target: InsertTarget = last !== undefined
    ? { anchor: last, position: 'after', section: 'body' }
    : { anchor: ownerId, position: 'appendInto', section: 'body' };
  const insertedId = editing.insert(build(newId), target);
  onSelect?.(insertedId);
}
