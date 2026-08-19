'use client';

/**
 * Issue #2162 — designer page canvas (center panel), slice A read-only.
 *
 * Renders the definition structurally on a white A4 sheet in "design mode":
 * bound paths and Scriban spans as violet mono chips, tables as header +
 * binding chips + meta chips, spacer/image placeholders. Every element is
 * clickable (hover/selected rings, type tag, blue `if` badge for visibleIf —
 * no evaluation). Clicking the sheet background selects Report settings.
 * Tokens per `docs/design_handoff_report_designer/README.md`.
 */

import type { CSSProperties, ReactNode } from 'react';
import { Box, Tooltip } from '@mui/material';
import { useDesignerT, type DesignerTranslate } from '../designerContext';
import {
  ELEMENT_DEFAULTS, REPORT_SETTINGS_ID, resolveLocalized,
  type DesignerLanguage, type KeyValuePairNode, type ReportDefinitionDoc,
  type ReportElementNode, type ReportStyleProps,
  type TableColumnNode, type TableElementNode,
} from '@platen-reports/model';
import type { DesignerEditing } from '@platen-reports/model';
import {
  HOVER_RING, MONO_FONT, SELECTED_RING, SUPPRESSED_BADGE, TEAL, TENANT_BADGE,
  VIOLET, VIOLET_BG, VIOLET_BORDER, VisibleIfBadge,
} from './designerConstants';

const PAGE_WIDTH = 620;
/** A4 portrait: 620px wide sheet at the 210:297 paper aspect. */
const PAGE_HEIGHT_PORTRAIT = PAGE_WIDTH * (297 / 210);
/** A4 landscape: the width stays 620, so the height inverts the aspect. */
const PAGE_HEIGHT_LANDSCAPE = PAGE_WIDTH * (210 / 297);
/** pt → screen px at the 620px page width (design spec). */
const PT_TO_PX = 1.55;
const px = (pt: number) => pt * PT_TO_PX;

const DEFAULT_FONT_SIZE = 9;
const INK = '#0F172A';
const MUTED = '#94A3B8';

interface RenderCtx {
  lang: DesignerLanguage;
  selectedId: string;
  onSelect: (id: string) => void;
  t: DesignerTranslate;
  /** Document base text size (`defaultStyle.fontSize`, else the QuestPDF default 9). */
  baseFontSize: number;
  /** Dotted path → field type from GET /reports/{key}/fields (best-effort, may be absent). */
  fieldTypes?: Map<string, string>;
  /** Tenant-overlay editing gestures; undefined ⇒ read-only (slice A). */
  editing?: DesignerEditing;
}

// ─── Style helpers ────────────────────────────────────────────────────────────

function textSx(st: ReportStyleProps | undefined, baseFontSize: number): CSSProperties {
  return {
    fontSize: px(st?.fontSize ?? baseFontSize),
    fontWeight: st?.bold ? 700 : 400,
    fontStyle: st?.italic ? 'italic' : undefined,
    color: st?.color || INK,
    textAlign: (st?.align || 'left') as CSSProperties['textAlign'],
  };
}

function boxSx(st: ReportStyleProps | undefined): CSSProperties {
  if (!st) return {};
  const border = (widthPt?: number) =>
    widthPt ? `${Math.max(1, px(widthPt) / 2)}px solid ${st.borderColor || '#CBD5E1'}` : undefined;
  return {
    paddingTop: st.paddingTop ? px(st.paddingTop) : undefined,
    paddingBottom: st.paddingBottom ? px(st.paddingBottom) : undefined,
    paddingLeft: st.paddingLeft ? px(st.paddingLeft) : undefined,
    paddingRight: st.paddingRight ? px(st.paddingRight) : undefined,
    borderTop: border(st.borderTop),
    borderBottom: border(st.borderBottom),
    borderLeft: border(st.borderLeft),
    borderRight: border(st.borderRight),
    background: st.backgroundColor || undefined,
  };
}

/** Flex sizing for a direct child of a row (weight = share, width = fixed pt). */
function rowChildSx(node: { weight?: number; width?: number | string }): CSSProperties {
  const fixed = typeof node.width === 'number' ? node.width : undefined;
  return {
    flex: fixed != null ? 'none' : `${node.weight ?? 1} 1 0`,
    width: fixed != null ? px(fixed) : undefined,
    minWidth: 0,
  };
}

// ─── Chips ────────────────────────────────────────────────────────────────────

/**
 * Violet mono chip for a bound path / template, with a gray format suffix.
 * When the field's type is known (from the typed field tree) the chip gets a
 * "path · type" tooltip.
 */
function PathChip({ text, format, fontSize, fieldType }: {
  text: string;
  format?: string;
  fontSize: number;
  fieldType?: string;
}) {
  const chip = (
    <Box
      component="span"
      sx={{
        fontSize, fontFamily: MONO_FONT, color: VIOLET, bgcolor: VIOLET_BG,
        border: `1px solid ${VIOLET_BORDER}`, borderRadius: '3px', px: '4px',
        overflowWrap: 'anywhere',
      }}
    >
      {text}
      {format ? <Box component="span" sx={{ color: MUTED }}>{` :${format}`}</Box> : null}
    </Box>
  );
  return fieldType ? <Tooltip title={`${text} · ${fieldType}`}>{chip}</Tooltip> : chip;
}

/** Small violet meta chip (table bind / grouping facts). */
function MetaChip({ children }: { children: ReactNode }) {
  return (
    <Box
      component="span"
      sx={{
        fontSize: 8.5, fontFamily: MONO_FONT, fontWeight: 700, color: VIOLET,
        bgcolor: VIOLET_BG, border: `1px solid ${VIOLET_BORDER}`, borderRadius: '3px',
        px: '4px', whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  );
}

// ─── Overlay badges (tenant-overlay editing) ──────────────────────────────────

/** Small text badge (SUPPRESSED / TENANT) shown on canvas elements in overlay mode. */
function OverlayBadge({ label, tone }: { label: string; tone: { text: string; bg: string; border: string } }) {
  return (
    <Box
      component="span"
      sx={{
        fontSize: 8, fontWeight: 700, whiteSpace: 'nowrap', lineHeight: 1.5,
        color: tone.text, bgcolor: tone.bg, border: `1px solid ${tone.border}`,
        borderRadius: '3px', px: '4px',
      }}
    >
      {label}
    </Box>
  );
}

// ─── Selectable wrapper ───────────────────────────────────────────────────────

interface SelectableProps {
  id: string;
  typeLabel: string;
  visibleIf?: string;
  selected: boolean;
  onSelect: (id: string) => void;
  sx?: CSSProperties;
  /** Absolute top-left overlay badges (SUPPRESSED / TENANT), placed under the type tag. */
  overlayBadges?: ReactNode;
  children: ReactNode;
}

function Selectable({ id, typeLabel, visibleIf, selected, onSelect, sx, overlayBadges, children }: SelectableProps) {
  return (
    <Box
      data-testid={`designer-canvas-el-${id}`}
      onClick={(e) => { e.stopPropagation(); onSelect(id); }}
      sx={{
        position: 'relative', cursor: 'pointer', borderRadius: '3px',
        boxShadow: selected ? SELECTED_RING : 'none',
        '&:hover': { boxShadow: selected ? SELECTED_RING : HOVER_RING },
        ...sx,
      }}
    >
      {selected && (
        <Box
          component="span"
          sx={{
            position: 'absolute', top: -16, left: -2, zIndex: 2,
            fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap',
            bgcolor: TEAL, color: '#fff', borderRadius: '4px 4px 4px 0', px: '6px', py: '1px',
          }}
        >
          {typeLabel}
        </Box>
      )}
      {overlayBadges && (
        <Box sx={{ position: 'absolute', top: -8, left: -2, zIndex: 2, display: 'flex', gap: '3px' }}>
          {overlayBadges}
        </Box>
      )}
      {visibleIf && (
        <VisibleIfBadge
          expression={visibleIf}
          size={8}
          sx={{ position: 'absolute', top: -8, right: -2, zIndex: 2, px: '4px' }}
        />
      )}
      {children}
    </Box>
  );
}

// ─── Per-type design renderers ────────────────────────────────────────────────

function TextContent({ node, ctx }: { node: Extract<ReportElementNode, { type: 'text' }>; ctx: RenderCtx }) {
  const ts = textSx(node.style, ctx.baseFontSize);
  const text = resolveLocalized(node.text, ctx.lang);
  const parts = text.split(/(\{\{[^}]*\}\})/g);
  return (
    <Box sx={{ ...ts, overflowWrap: 'anywhere' }}>
      {parts.map((part, i) =>
        /^\{\{/.test(part) ? (
          <Box
            // eslint-disable-next-line react/no-array-index-key
            key={i}
            component="span"
            sx={{
              fontFamily: MONO_FONT, color: VIOLET, bgcolor: VIOLET_BG,
              border: `1px solid ${VIOLET_BORDER}`, borderRadius: '3px', px: '3px',
              fontSize: Number(ts.fontSize) * 0.85,
            }}
          >
            {part.replace(/^\{\{\s*|\s*\}\}$/g, '')}
          </Box>
        ) : (
          // eslint-disable-next-line react/no-array-index-key
          <Box key={i} component="span">{part}</Box>
        ),
      )}
    </Box>
  );
}

function FieldContent({ node, ctx }: { node: Extract<ReportElementNode, { type: 'field' }>; ctx: RenderCtx }) {
  const ts = textSx(node.style, ctx.baseFontSize);
  return (
    <Box sx={{ textAlign: ts.textAlign }}>
      <PathChip
        text={node.path}
        format={node.format}
        fontSize={Number(ts.fontSize) * 0.92}
        fieldType={ctx.fieldTypes?.get(node.path)}
      />
    </Box>
  );
}

function TableContent({ node, ctx }: { node: TableElementNode; ctx: RenderCtx }) {
  const fs = px(node.style?.fontSize ?? ctx.baseFontSize);
  const colSx = (c: TableColumnNode): CSSProperties => ({
    flex: c.width != null ? 'none' : `${c.weight ?? 1} 1 0`,
    width: c.width != null ? px(c.width) : undefined,
    minWidth: 0,
    textAlign: (c.align || 'left') as CSSProperties['textAlign'],
  });
  return (
    <Box>
      {/* Header row — each column header is selectable by its own id. */}
      <Box sx={{ display: 'flex', gap: 1, borderBottom: '1.5px solid #94A3B8', pb: '2px' }}>
        {node.columns.map((c) => {
          const suppressed = ctx.editing?.isSuppressed(c.id) ?? false;
          return (
            <Box
              key={c.id}
              data-testid={`designer-canvas-el-${c.id}`}
              onClick={(e) => { e.stopPropagation(); ctx.onSelect(c.id); }}
              sx={{
                ...colSx(c), cursor: 'pointer', borderRadius: '3px',
                opacity: suppressed ? 0.35 : undefined,
                boxShadow: ctx.selectedId === c.id ? SELECTED_RING : 'none',
                '&:hover': { boxShadow: ctx.selectedId === c.id ? SELECTED_RING : HOVER_RING },
              }}
            >
              <Box
                component="span"
                sx={{ fontSize: fs, fontWeight: 700, textDecoration: suppressed ? 'line-through' : 'none' }}
              >
                {resolveLocalized(c.header, ctx.lang)}
              </Box>
            </Box>
          );
        })}
      </Box>
      {/* One chip-row showing each column's binding. */}
      <Box sx={{ display: 'flex', gap: 1, py: '3px', borderBottom: '1px solid #E2E8F0' }}>
        {node.columns.map((c) => (
          <Box key={c.id} sx={colSx(c)}>
            <PathChip
              text={c.template != null ? '{{…}}' : c.path ?? ''}
              format={c.format}
              fontSize={fs * 0.92}
              fieldType={c.template == null && c.path ? ctx.fieldTypes?.get(c.path) : undefined}
            />
          </Box>
        ))}
      </Box>
      {/* Meta chips: list source + grouping/totals facts. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '5px', pt: '4px', flexWrap: 'wrap' }}>
        <MetaChip>↻ {node.bind || ctx.t('designerCanvasNoSource')}</MetaChip>
        {node.groupBy ? <MetaChip>{ctx.t('designerCanvasGroupBy', { field: node.groupBy })}</MetaChip> : null}
        {(node.groupTotals?.length ?? 0) > 0 ? <MetaChip>{ctx.t('designerCanvasGroupTotals')}</MetaChip> : null}
        {(node.totals?.length ?? 0) > 0 ? <MetaChip>{ctx.t('designerCanvasGrandTotal')}</MetaChip> : null}
        {node.repeatHeader === false ? <MetaChip>{ctx.t('designerCanvasHeaderOnce')}</MetaChip> : null}
      </Box>
    </Box>
  );
}

function KeyValueGridContent({ node, ctx }: {
  node: Extract<ReportElementNode, { type: 'keyValueGrid' }>;
  ctx: RenderCtx;
}) {
  const fs = px(node.style?.fontSize ?? ctx.baseFontSize);
  const pairValue = (p: KeyValuePairNode) =>
    p.template != null
      ? `{{…}} ${resolveLocalized(p.template, ctx.lang).slice(0, 22)}`
      : p.path ?? '';
  // Column-count default mirrors the server parser (ReportDefinitionParser.cs `?? 2`).
  const columns = node.columns ?? Number(ELEMENT_DEFAULTS.keyValueGrid.columns);
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, columnGap: '14px', rowGap: '4px' }}>
      {node.pairs.map((p) => {
        const suppressed = ctx.editing?.isSuppressed(p.id) ?? false;
        return (
        <Box
          key={p.id}
          data-testid={`designer-canvas-el-${p.id}`}
          onClick={(e) => { e.stopPropagation(); ctx.onSelect(p.id); }}
          sx={{
            display: 'grid', gridTemplateColumns: '42% 58%', gap: '6px', alignItems: 'baseline',
            p: '1px 2px', cursor: 'pointer', borderRadius: '3px',
            opacity: suppressed ? 0.35 : undefined,
            boxShadow: ctx.selectedId === p.id ? SELECTED_RING : 'none',
            '&:hover': { boxShadow: ctx.selectedId === p.id ? SELECTED_RING : HOVER_RING },
          }}
        >
          <Box
            component="span"
            sx={{ fontSize: fs, fontWeight: 600, color: '#475569', textDecoration: suppressed ? 'line-through' : 'none' }}
          >
            {resolveLocalized(p.label, ctx.lang)}
          </Box>
          <Box sx={{ justifySelf: 'start' }}>
            <PathChip
              text={pairValue(p)}
              format={p.format}
              fontSize={fs * 0.92}
              fieldType={p.template == null && p.path ? ctx.fieldTypes?.get(p.path) : undefined}
            />
          </Box>
        </Box>
        );
      })}
    </Box>
  );
}

/**
 * Shared child-sequence renderer. The server pairs consecutive half-width
 * containers two-per-row in EVERY element sequence — body, column children,
 * and container children alike (QuestPdfReportRenderer.RenderElementSequence) —
 * so the canvas applies the same pairing at every nesting level: a 2-column
 * grid where half containers span one cell and everything else spans both.
 */
function ElementSequence({ nodes, ctx, rowGap, columnGap, sx }: {
  nodes: ReportElementNode[];
  ctx: RenderCtx;
  rowGap: string;
  columnGap: string;
  sx?: CSSProperties;
}) {
  const isHalf = (node: ReportElementNode) => node.type === 'container' && node.width === 'half';
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap, columnGap, alignContent: 'start', ...sx }}>
      {nodes.map((node) => (
        <Box key={node.id} sx={{ gridColumn: isHalf(node) ? 'span 1' : 'span 2' }}>
          <CanvasElement node={node} ctx={ctx} />
        </Box>
      ))}
    </Box>
  );
}

function CanvasElement({ node, ctx }: { node: ReportElementNode; ctx: RenderCtx }) {
  const { lang, selectedId, onSelect, t, editing } = ctx;
  const st = node.style;

  const suppressed = editing?.isSuppressed(node.id) ?? false;
  const tenant = editing?.isOverlayInsert(node.id) ?? false;
  const overlayBadges = suppressed || tenant ? (
    <>
      {suppressed && <OverlayBadge label={t('designerSuppressedBadge')} tone={SUPPRESSED_BADGE} />}
      {tenant && <OverlayBadge label={t('designerTenantInsertBadge')} tone={TENANT_BADGE} />}
    </>
  ) : undefined;
  const overlaySx: CSSProperties = {
    opacity: suppressed ? 0.35 : undefined,
    filter: suppressed ? 'grayscale(1)' : undefined,
    outline: tenant ? `1.5px dashed ${TENANT_BADGE.text}` : undefined,
    outlineOffset: tenant ? 2 : undefined,
  };

  const wrap = (inner: ReactNode, extraSx?: CSSProperties) => (
    <Selectable
      id={node.id}
      typeLabel={t(`elementType.${node.type}`)}
      visibleIf={node.visibleIf}
      selected={selectedId === node.id}
      onSelect={onSelect}
      overlayBadges={overlayBadges}
      sx={{ ...boxSx(st), ...overlaySx, ...extraSx }}
    >
      {inner}
    </Selectable>
  );

  switch (node.type) {
    case 'row':
      return wrap(
        <Box sx={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
          {node.children.map((child) => (
            <Box key={child.id} sx={rowChildSx(child)}>
              <CanvasElement node={child} ctx={ctx} />
            </Box>
          ))}
        </Box>,
      );
    case 'column':
      return wrap(
        <ElementSequence
          nodes={node.children}
          ctx={ctx}
          // Spacing default mirrors the renderer (QuestPdfReportRenderer.cs `Spacing ?? 4`).
          rowGap={`${px(node.spacing ?? Number(ELEMENT_DEFAULTS.column.spacing)) + 2}px`}
          columnGap="10px"
        />,
      );
    case 'container': {
      const title = resolveLocalized(node.title, lang);
      return wrap(
        <Box sx={{ border: '1px solid #CBD5E1', borderRadius: '4px', overflow: 'hidden', bgcolor: '#fff', height: '100%', boxSizing: 'border-box' }}>
          {title && (
            <Box sx={{
              bgcolor: '#F1F5F9', p: '4px 9px', fontSize: px(8), fontWeight: 700,
              letterSpacing: '0.05em', textTransform: 'uppercase', color: '#334155',
            }}>
              {title}
            </Box>
          )}
          <Box sx={{ p: '7px 9px' }}>
            <ElementSequence nodes={node.children} ctx={ctx} rowGap="6px" columnGap="6px" />
          </Box>
        </Box>,
        { height: '100%' },
      );
    }
    case 'table':
      return wrap(<TableContent node={node} ctx={ctx} />);
    case 'keyValueGrid':
      return wrap(<KeyValueGridContent node={node} ctx={ctx} />);
    case 'text':
      return wrap(<TextContent node={node} ctx={ctx} />);
    case 'field':
      return wrap(<FieldContent node={node} ctx={ctx} />);
    case 'spacer':
      return wrap(
        <Box
          aria-label={t('elementType.spacer')}
          sx={{
            height: px(node.height ?? 8),
            background: 'repeating-linear-gradient(90deg, #F1F5F9, #F1F5F9 4px, transparent 4px, transparent 8px)',
          }}
        />,
      );
    case 'line':
      return wrap(
        <Box
          aria-label={t('elementType.line')}
          sx={{ borderTop: `${Math.max(1, px(node.thickness ?? 0.5) / 2)}px solid ${node.color || '#94A3B8'}` }}
        />,
      );
    case 'image':
      return wrap(
        <Box sx={{
          // Height default mirrors the renderer's logo height cap (30).
          height: px(node.height ?? Number(ELEMENT_DEFAULTS.image.height)),
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'repeating-linear-gradient(45deg, #F8FAFC, #F8FAFC 6px, #F1F5F9 6px, #F1F5F9 12px)',
          border: '1px dashed #CBD5E1', borderRadius: '4px',
          color: MUTED, fontFamily: MONO_FONT, fontSize: 9.5,
        }}>
          {node.source || t('elementType.image')}
        </Box>,
      );
    case 'pageNumber':
      return wrap(
        <Box sx={{ textAlign: (st?.align || 'left') as CSSProperties['textAlign'] }}>
          <PathChip
            text={node.template ?? String(ELEMENT_DEFAULTS.pageNumber.template)}
            fontSize={px(st?.fontSize ?? ctx.baseFontSize) * 0.92}
          />
        </Box>,
      );
    default:
      return null;
  }
}

// ─── The A4 sheet ─────────────────────────────────────────────────────────────

export interface DesignerCanvasProps {
  doc: ReportDefinitionDoc;
  lang: DesignerLanguage;
  selectedId: string;
  onSelect: (id: string) => void;
  scale: number;
  /** Dotted path → field type map (from GET /reports/{key}/fields), for chip tooltips. */
  fieldTypes?: Map<string, string>;
  /** Tenant-overlay editing gestures; undefined ⇒ read-only (slice A). */
  editing?: DesignerEditing;
}

export default function DesignerCanvas({ doc, lang, selectedId, onSelect, scale, fieldTypes, editing }: DesignerCanvasProps) {
  const t = useDesignerT();
  const baseFontSize = doc.defaultStyle?.fontSize ?? DEFAULT_FONT_SIZE;
  const ctx: RenderCtx = { lang, selectedId, onSelect, t, baseFontSize, fieldTypes, editing };
  // Margin default mirrors the server parser (ReportDefinitionParser.cs `?? 24`).
  const margin = px(doc.page?.margin ?? 24);
  const pageHeight = doc.page?.orientation === 'landscape' ? PAGE_HEIGHT_LANDSCAPE : PAGE_HEIGHT_PORTRAIT;

  return (
    <Box sx={{ transform: `scale(${scale})`, transformOrigin: 'top center', my: 4 }}>
      <Box
        data-testid="designer-canvas-sheet"
        onClick={() => onSelect(REPORT_SETTINGS_ID)}
        sx={{
          width: PAGE_WIDTH, minHeight: pageHeight, boxSizing: 'border-box',
          bgcolor: '#fff', borderRadius: '2px', p: `${margin}px`,
          boxShadow: '0 1px 3px rgba(15,23,42,0.12), 0 8px 28px rgba(15,23,42,0.10)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {doc.pageHeader && <CanvasElement node={doc.pageHeader} ctx={ctx} />}

        {/* Body: consecutive half-width containers pair two-per-row on the grid. */}
        <ElementSequence nodes={doc.body ?? []} ctx={ctx} rowGap="10px" columnGap="10px" sx={{ paddingTop: 12 }} />

        {/* Fine-effort footer pinning: a flex spacer pushes it to the sheet bottom. */}
        <Box sx={{ flexGrow: 1 }} />
        {doc.pageFooter && (
          <Box sx={{ mt: '14px' }}>
            <CanvasElement node={doc.pageFooter} ctx={ctx} />
          </Box>
        )}
      </Box>
    </Box>
  );
}
