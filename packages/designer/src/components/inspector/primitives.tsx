'use client';

/**
 * Inspector primitives — the shared leaf layer of the designer inspector.
 *
 * Read-only display rows (`PropRow`, `ItemList`, `ValueSourceRow`), the collapsed
 * "Advanced" accordion, and the editable controls (`EditTextInput`, `EditSeg`, …)
 * that both the tenant-overlay and standard-authoring bodies compose. Also the
 * designer-local grayscale tokens and the style-row metadata shared by the
 * read-only and editable Style sections.
 *
 * Internal to `inspector/` — the folder's entry point is `DesignerInspector.tsx`.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  Box, ButtonBase, Collapse, IconButton, Switch, TextField,
  ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { ChevronDown, Lock, Plus, RotateCcw } from 'lucide-react';
import { useDesignerT, type DesignerTranslate } from '../../designerContext';
import {
  resolveLocalized,
  type DesignerLanguage,
  type LocalizedTextValue,
} from '@platen-reports/model';
import {
  MONO_FONT as MONO, TEAL, TEAL_BG, TEAL_RING, VIOLET, VIOLET_BG, VIOLET_BORDER,
} from '../designerConstants';

// Local grayscale tokens (README §Design tokens) — the designer is a deliberately light surface.
export const INK = '#0F172A';
export const SLATE = '#475569';
export const MUTE = '#94A3B8';

export const STYLE_ROWS: Array<{ key: string; labelKey: string; kind: 'num' | 'bool' | 'align' | 'color' }> = [
  { key: 'fontSize', labelKey: 'designerStyleFontSize', kind: 'num' },
  { key: 'bold', labelKey: 'designerStyleBold', kind: 'bool' },
  { key: 'italic', labelKey: 'designerStyleItalic', kind: 'bool' },
  { key: 'align', labelKey: 'designerStyleAlign', kind: 'align' },
  { key: 'color', labelKey: 'designerStyleColor', kind: 'color' },
  { key: 'backgroundColor', labelKey: 'designerStyleBackgroundColor', kind: 'color' },
  { key: 'paddingTop', labelKey: 'designerStylePaddingTop', kind: 'num' },
  { key: 'paddingBottom', labelKey: 'designerStylePaddingBottom', kind: 'num' },
  { key: 'paddingLeft', labelKey: 'designerStylePaddingLeft', kind: 'num' },
  { key: 'paddingRight', labelKey: 'designerStylePaddingRight', kind: 'num' },
  { key: 'borderTop', labelKey: 'designerStyleBorderTop', kind: 'num' },
  { key: 'borderBottom', labelKey: 'designerStyleBorderBottom', kind: 'num' },
  { key: 'borderLeft', labelKey: 'designerStyleBorderLeft', kind: 'num' },
  { key: 'borderRight', labelKey: 'designerStyleBorderRight', kind: 'num' },
  { key: 'borderColor', labelKey: 'designerStyleBorderColor', kind: 'color' },
];

export const STYLE_KEYS = STYLE_ROWS.map((row) => row.key);

const COLOR_SWATCHES = ['#0F172A', '#475569', '#B00020', '#B45309', '#166534', '#1D4ED8', '#0F766E'];

/** Interfaces lack implicit index signatures — bridge into the model helpers. */
export function asRecord(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}

/** Localized display label for an `align` value (unknown values pass through). */
export function alignLabel(t: DesignerTranslate, value: string): string {
  return value === 'center' ? t('designerAlignCenter')
    : value === 'right' ? t('designerAlignRight')
      : value === 'left' ? t('designerAlignLeft') : value;
}

/**
 * Muted " · type" suffix for a bound path, when the typed field tree (fix for
 * GET /reports/{key}/fields wiring) knows the path. Best-effort: unknown paths
 * (e.g. table-column paths relative to the row item) render no suffix.
 */
export function typeSuffix(fieldTypes: Map<string, string> | undefined, path: string | undefined): ReactNode {
  const fieldType = path ? fieldTypes?.get(path) : undefined;
  if (!fieldType) return null;
  return (
    <Box component="span" data-testid="field-type-suffix" sx={{ color: MUTE, fontWeight: 400 }}>
      {` · ${fieldType}`}
    </Box>
  );
}

// ─── Designer-local primitives ──────────────────────────────────────────────

const overrideDot = (
  <Box
    component="span"
    data-testid="override-dot"
    sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: TEAL, flexShrink: 0, display: 'inline-block' }}
  />
);

/** Read-only property row: label + value, teal dot when overridden. */
export function PropRow({ label, value, overridden = false, mono = false, stacked = false }: {
  label: string;
  value: ReactNode;
  overridden?: boolean;
  mono?: boolean;
  stacked?: boolean;
}) {
  if (stacked) {
    return (
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 600, color: SLATE }}>{label}</Typography>
          {overridden && overrideDot}
        </Box>
        <Typography sx={{
          fontSize: 12.5, color: INK, fontFamily: mono ? MONO : undefined,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          border: 1, borderColor: 'divider', borderRadius: '8px', px: 1.25, py: 0.75, bgcolor: '#F8FAFC',
        }}>
          {value}
        </Typography>
      </Box>
    );
  }
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 600, color: SLATE, flexGrow: 1 }}>{label}</Typography>
      {overridden && overrideDot}
      <Typography sx={{
        fontSize: 12, color: INK, fontFamily: mono ? MONO : undefined,
        textAlign: 'right', wordBreak: 'break-word', minWidth: 0,
      }}>
        {value}
      </Typography>
    </Box>
  );
}

/**
 * Collapsed "Advanced" accordion — uppercase 11px title, right-aligned badge:
 * teal "n changed" pill (or a custom label, e.g. the parameter count) when
 * `count > 0`, gray "defaults" otherwise. Designer-local by design.
 */
export function AdvSection({ title, count, badgeLabel, children }: {
  title: string;
  count: number;
  badgeLabel?: string;
  children: ReactNode;
}) {
  const t = useDesignerT();
  const [open, setOpen] = useState(false);
  const changed = count > 0;
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '10px', overflow: 'hidden' }}>
      <ButtonBase
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        sx={{ width: '100%', px: 1.5, py: 1, display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'flex-start' }}
      >
        <ChevronDown
          size={13}
          style={{ color: MUTE, flexShrink: 0, transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 120ms' }}
        />
        <Typography sx={{
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
          color: SLATE, flexGrow: 1, textAlign: 'left',
        }}>
          {title}
        </Typography>
        {changed ? (
          <Box component="span" sx={{
            fontSize: 10, fontWeight: 700, color: TEAL, bgcolor: TEAL_BG,
            border: `1px solid ${TEAL_RING}`, borderRadius: '999px', px: 0.875, py: 0.125, whiteSpace: 'nowrap',
          }}>
            {badgeLabel ?? t('designerChangedBadge', { count })}
          </Box>
        ) : (
          <Box component="span" sx={{ fontSize: 10, fontWeight: 600, color: MUTE }}>
            {t('designerDefaultsBadge')}
          </Box>
        )}
      </ButtonBase>
      <Collapse in={open}>
        <Box sx={{ px: 1.5, pb: 1.5, pt: 0.25, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          {children}
        </Box>
      </Collapse>
    </Box>
  );
}

export function NoteText({ children }: { children: ReactNode }) {
  return <Typography sx={{ fontSize: 11.5, color: MUTE, lineHeight: 1.5 }}>{children}</Typography>;
}

export function ListLabel({ children }: { children: ReactNode }) {
  return <Typography sx={{ fontSize: 12, fontWeight: 600, color: SLATE, mb: 0.5 }}>{children}</Typography>;
}

/** Display list of table columns / grid pairs: label left, binding mono right. */
export function ItemList({ items }: { items: Array<{ id: string; primary: string; secondary: string }> }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {items.map((item) => (
        <Box key={item.id} sx={{
          display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.75,
          border: 1, borderColor: 'divider', borderRadius: '8px',
        }}>
          <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: INK, flexGrow: 1, wordBreak: 'break-word' }}>
            {item.primary}
          </Typography>
          <Typography sx={{ fontSize: 10.5, fontFamily: MONO, color: MUTE, flexShrink: 0 }}>
            {item.secondary}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

/** "Value" display for a pair / table column: Field|Template kind pill + binding. */
export function ValueSourceRow({ path, template, lang, fieldTypes }: {
  path?: string;
  template?: LocalizedTextValue;
  lang: DesignerLanguage;
  fieldTypes?: Map<string, string>;
}) {
  const t = useDesignerT();
  const isTemplate = template != null;
  return (
    <Box>
      <Typography sx={{ fontSize: 12, fontWeight: 600, color: SLATE, mb: 0.5 }}>{t('designerFieldValue')}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Box component="span" sx={{
          fontSize: 10, fontWeight: 700, color: SLATE, border: 1, borderColor: 'divider',
          borderRadius: '999px', px: 0.875, py: 0.125, flexShrink: 0,
        }}>
          {t(isTemplate ? 'designerValueKindTemplate' : 'designerValueKindField')}
        </Box>
        <Typography sx={{
          fontSize: 11.5, fontFamily: MONO, color: VIOLET, bgcolor: VIOLET_BG,
          border: `1px solid ${VIOLET_BORDER}`, borderRadius: '6px', px: 0.75, py: 0.25, wordBreak: 'break-all',
        }}>
          {isTemplate ? resolveLocalized(template, lang) : (path ?? '—')}
          {!isTemplate && typeSuffix(fieldTypes, path)}
        </Typography>
      </Box>
    </Box>
  );
}

export function FormatRow({ format }: { format?: string }) {
  const t = useDesignerT();
  return (
    <PropRow
      label={t('designerFieldFormat')}
      value={format ?? t('designerValueDefaultFormat')}
      overridden={!!format}
      mono={!!format}
    />
  );
}

// ─── Editable controls ──────────────────────────────────────────────────────

/** Editable field row: label + override dot + reset-to-default (RotateCcw) + control. */
export function EditFieldRow({ label, touched, onReset, defaultHint, inline = false, children }: {
  label: string;
  touched: boolean;
  onReset?: () => void;
  defaultHint?: string;
  inline?: boolean;
  children: ReactNode;
}) {
  const t = useDesignerT();
  const tip = t('designerResetTooltip', { default: defaultHint ?? t('designerColorDefault') });
  return (
    <Box sx={{
      display: 'flex', flexDirection: inline ? 'row' : 'column',
      gap: inline ? 1 : 0.5, alignItems: inline ? 'center' : 'stretch',
      justifyContent: inline ? 'space-between' : 'flex-start',
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minHeight: 18 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: SLATE }}>{label}</Typography>
        {touched && overrideDot}
        {touched && onReset && (
          <Tooltip title={tip}>
            <IconButton
              size="small"
              data-testid="reset-prop"
              aria-label={tip}
              onClick={onReset}
              sx={{ p: 0.25, color: MUTE }}
            >
              <RotateCcw size={12} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      {children}
    </Box>
  );
}

/** Structure owned by the standard definition: dimmed, non-interactive, lock note. */
export function LockedControl({ note, children }: { note?: string; children: ReactNode }) {
  const t = useDesignerT();
  return (
    <Box>
      <Box data-testid="locked-control" style={{ opacity: 0.55, pointerEvents: 'none' }}>
        {children}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5, color: MUTE }}>
        <Lock size={11} />
        <Typography sx={{ fontSize: 10.5, color: MUTE }}>{note ?? t('designerLockOwnedByStandard')}</Typography>
      </Box>
    </Box>
  );
}

/**
 * Every keystroke here otherwise flows straight into `setProp`, which re-merges and
 * re-serializes the whole document (and cascades into the unmemoized canvas/JSON panel) —
 * on a large report, fast typing visibly lags. So this commits locally on every keystroke
 * (the field stays instantly responsive) but only calls `onChange` after a short pause, and
 * immediately on blur so a click-away never drops the tail of an edit.
 */
const TEXT_COMMIT_DEBOUNCE_MS = 300;

export function EditTextInput({ value, onChange, mono = false, placeholder, multiline = false }: {
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
  placeholder?: string;
  multiline?: boolean;
}) {
  const [local, setLocal] = useState(value ?? '');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resync whenever the bound value changes for a reason other than our own pending commit —
  // a reset/undo, or (this instance isn't remounted across same-type siblings) the selection
  // moving to a different element/column/pair while a debounce was in flight. A still-pending
  // timer keeps the `onChange` closure it captured at keystroke time, so it lands on whichever
  // field the user was actually typing in, unaffected by this resync.
  useEffect(() => {
    setLocal(value ?? '');
  }, [value]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const flush = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      if (local !== value) onChange(local);
    }
  };

  return (
    <TextField
      size="small"
      fullWidth
      value={local}
      placeholder={placeholder}
      multiline={multiline}
      minRows={multiline ? 3 : undefined}
      onChange={(e) => {
        const next = e.target.value;
        setLocal(next);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => { timerRef.current = null; onChange(next); }, TEXT_COMMIT_DEBOUNCE_MS);
      }}
      onBlur={flush}
      inputProps={mono ? { style: { fontFamily: MONO, fontSize: 12 } } : undefined}
    />
  );
}

/**
 * Mono path/bind input backed by a native `<datalist>` of the known field paths
 * (`fieldTypes`-derived) — a text input the browser augments into a picker over
 * the known paths, which still accepts a free path (table-column paths are relative
 * to the row item and need not appear in the flat scalar map). Degrades to a plain
 * text field when no options are available.
 */
export function EditPathInput({ value, onChange, options, placeholder, testId }: {
  value: string;
  onChange: (value: string) => void;
  options?: string[];
  placeholder?: string;
  testId?: string;
}) {
  const listId = useId();
  const hasOptions = !!options && options.length > 0;
  return (
    <Box sx={{ width: '100%' }}>
      <TextField
        size="small"
        fullWidth
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        inputProps={{
          style: { fontFamily: MONO, fontSize: 12 },
          list: hasOptions ? listId : undefined,
          'data-testid': testId,
        }}
      />
      {hasOptions && (
        <datalist id={listId}>
          {options!.map((option) => <option key={option} value={option} />)}
        </datalist>
      )}
    </Box>
  );
}

export function EditNumberInput({ value, onChange, step = 1 }: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  step?: number;
}) {
  return (
    <TextField
      size="small"
      type="number"
      value={value ?? ''}
      inputProps={{ step }}
      sx={{ width: 108 }}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
    />
  );
}

export function EditToggle({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return <Switch size="small" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
}

export function EditSeg({ value, onChange, options }: {
  value: string | number;
  onChange: (value: string | number) => void;
  options: Array<{ value: string | number; label: string }>;
}) {
  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={value}
      onChange={(_, next) => { if (next !== null) onChange(next as string | number); }}
    >
      {options.map((option) => (
        <ToggleButton key={String(option.value)} value={option.value} sx={{ textTransform: 'none', py: 0.25, px: 1, fontSize: 12 }}>
          {option.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

/** Curated swatch row + free hex; empty selects the (inherited) default. */
export function EditColorInput({ value, onChange }: { value?: string; onChange: (value: string | undefined) => void }) {
  const t = useDesignerT();
  const swatch = (bg: string, active: boolean, onClick: () => void, ariaLabel: string) => (
    <ButtonBase
      key={ariaLabel}
      aria-label={ariaLabel}
      onClick={onClick}
      sx={{
        width: 20, height: 20, borderRadius: '6px',
        border: active ? `2px solid ${TEAL}` : '1px solid', borderColor: active ? TEAL : 'divider',
        background: bg,
      }}
    />
  );
  return (
    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
      {swatch(
        'repeating-linear-gradient(45deg,#fff,#fff 3px,#E2E8F0 3px,#E2E8F0 6px)',
        !value, () => onChange(undefined), t('designerColorDefault'),
      )}
      {COLOR_SWATCHES.map((color) => swatch(color, value === color, () => onChange(color), color))}
      <TextField
        size="small"
        value={value ?? ''}
        placeholder="#hex"
        onChange={(e) => onChange(e.target.value || undefined)}
        sx={{ width: 78 }}
        inputProps={{ style: { fontFamily: MONO, fontSize: 11 } }}
      />
    </Box>
  );
}

/** Teal "+ Add …" pill for inserting a table column / grid pair (editing mode only). */
export function AddItemButton({ label, testId, onClick }: { label: string; testId: string; onClick: () => void }) {
  return (
    <ButtonBase
      onClick={onClick}
      data-testid={testId}
      sx={{
        display: 'inline-flex', width: 'fit-content', alignItems: 'center', gap: 0.5, mt: 0.75,
        fontSize: 11.5, fontWeight: 600, color: TEAL, bgcolor: TEAL_BG,
        border: `1px solid ${TEAL_RING}`, borderRadius: '8px', px: 1, py: 0.5,
      }}
    >
      <Plus size={13} />
      {label}
    </ButtonBase>
  );
}
