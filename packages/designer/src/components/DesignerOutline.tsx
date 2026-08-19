'use client';

/**
 * Issue #2162 — designer outline tree (left panel), slice A read-only.
 * Issue #2164 — slice C adds standard-mode drag-to-reorder (within a sibling array
 * only) and an inline add-into affordance on container/row/column rows.
 *
 * Renders the report definition as a selectable tree: a "Report settings"
 * pseudo-node on top, then collapsible Page header / Body / Page footer groups
 * with one row per element — recursively, including keyValueGrid pairs and
 * table columns as selectable child rows (they carry their own ids, the public
 * overlay-anchor contract). Drag-reorder is unlocked only in standard mode
 * (`editing.reorder` present); in tenant / read-only mode the drag handle is
 * disabled. Visual language per `docs/design_handoff_report_designer/README.md`.
 */

import { useEffect, useRef, useState } from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import {
  ChevronDown, ChevronRight, Columns3, Equal, EyeOff, FileText, GripVertical, type LucideIcon,
  PanelBottom, PanelTop, Plus, RotateCcw, Settings, Trash2,
} from 'lucide-react';
import { useDesignerT } from '../designerContext';
import {
  childElements, REPORT_SETTINGS_ID, resolveLocalized,
  type DesignerLanguage, type ReportDefinitionDoc, type ReportElementNode,
} from '@platen-reports/model';
import { BODY_PSEUDO_ANCHOR, type ReportOverlayDoc } from '@platen-reports/model';
import type { DesignerEditing, InsertTarget } from '@platen-reports/model';
import {
  MONO_FONT, SUPPRESSED_BADGE, TEAL, TEAL_BG, TEAL_RING, TENANT_BADGE,
  TYPE_ICONS, VisibleIfBadge,
} from './designerConstants';
import AddBlockDialog from './AddBlockDialog';

/** The element's meaningful display label; empty string means "fall back to id". */
function elementLabel(node: ReportElementNode, lang: DesignerLanguage): string {
  switch (node.type) {
    case 'text':
      // Show the resolved text with the Scriban braces stripped, like the design.
      return resolveLocalized(node.text, lang).replace(/\{\{\s*|\s*\}\}/g, '').trim() || node.id;
    case 'field':
      return node.path || node.id;
    case 'container':
      return resolveLocalized(node.title, lang) || node.id;
    case 'table':
      return node.bind || node.id;
    default:
      return node.id;
  }
}

// ─── Row ──────────────────────────────────────────────────────────────────────

/** The element currently being dragged, with the sibling array it belongs to. */
interface DragInfo {
  id: string;
  /** 'body' / 'header' / 'footer' or the owning element id (children/columns/pairs). */
  parentId: string;
  /** Index of the dragged row within its sibling array. */
  index: number;
}

interface OutlineRowProps {
  id: string;
  icon: LucideIcon;
  iconLabel: string;
  label: string;
  depth: number;
  visibleIf?: string;
  selected: boolean;
  onSelect: (id: string) => void;
  /** Tenant-overlay editing gestures; undefined ⇒ read-only (slice A). */
  editing?: DesignerEditing;
  /** Sibling array this row lives in (drag-reorder target scope). */
  parentId: string;
  /** This row's index within `parentId`'s array. */
  index: number;
  /** Section owning this row — drives the pageNumber palette lock on add-into. */
  section: 'header' | 'body' | 'footer';
  /** Shared drag state (parent-owned so a drag spans sibling rows). */
  drag: DragInfo | null;
  setDrag: (d: DragInfo | null) => void;
  /** True when this row accepts child elements via inline add (container/row/column). */
  canAddInto?: boolean;
  /** Open the add-block dialog against a resolved target (standard-mode add-into). */
  onAdd?: (target: InsertTarget) => void;
}

function OutlineRow({
  id, icon: Icon, iconLabel, label, depth, visibleIf, selected, onSelect, editing,
  parentId, index, section, drag, setDrag, canAddInto, onAdd,
}: OutlineRowProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const t = useDesignerT();
  const [over, setOver] = useState<'before' | 'after' | null>(null);

  const suppressed = editing?.isSuppressed(id) ?? false;
  const tenant = editing?.isOverlayInsert(id) ?? false;
  // Reorder is a standard-mode capability: unlocked only when `editing.reorder` exists.
  const canReorder = !!editing?.reorder;
  const canDrag = canReorder && !suppressed;
  const beingDragged = drag?.id === id;

  // Selection sync: when this row becomes selected (e.g. from a canvas click),
  // make sure it is visible in the outline.
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  /** Where the pointer sits relative to this row's vertical midpoint. */
  const dropSide = (e: React.DragEvent): 'before' | 'after' => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? 'before' : 'after';
  };

  const dndHandlers = canDrag
    ? {
        draggable: true,
        onDragStart: (e: React.DragEvent) => {
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', id);
          }
          setDrag({ id, parentId, index });
        },
        onDragEnd: () => { setDrag(null); setOver(null); },
        onDragOver: (e: React.DragEvent) => {
          // Same-parent only — a cross-parent hover neither previews nor allows a drop.
          if (!drag || drag.id === id || drag.parentId !== parentId) return;
          e.preventDefault();
          setOver(dropSide(e));
        },
        onDragLeave: () => setOver(null),
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          const active = drag;
          setOver(null);
          setDrag(null);
          if (!active || active.id === id || active.parentId !== parentId) return;
          // reorderSiblings splices out `fromIndex` then splices in at `toIndex`
          // (post-removal). Translate the drop side into that post-removal index.
          const insertAt = dropSide(e) === 'after' ? index + 1 : index;
          const toIndex = insertAt > active.index ? insertAt - 1 : insertAt;
          editing?.reorder?.(parentId, active.index, toIndex);
        },
      }
    : {};

  return (
    <Box
      ref={ref}
      data-testid={`designer-outline-row-${id}`}
      onClick={() => onSelect(id)}
      {...dndHandlers}
      sx={{
        display: 'flex', alignItems: 'center', gap: 0.875,
        pl: `${10 + depth * 16}px`, pr: 1, py: '5px',
        borderRadius: '7px', cursor: 'pointer', userSelect: 'none',
        opacity: beingDragged ? 0.35 : 1,
        bgcolor: selected ? TEAL_BG : 'transparent',
        boxShadow: over === 'before'
          ? `inset 0 2px 0 ${TEAL}`
          : over === 'after'
            ? `inset 0 -2px 0 ${TEAL}`
            : selected ? `inset 0 0 0 1px ${TEAL_RING}` : 'none',
        '&:hover': { bgcolor: selected ? TEAL_BG : '#F8FAFC' },
        '&:hover .designer-outline-row-action, &:focus-within .designer-outline-row-action': { opacity: 1 },
        '&:hover .designer-outline-row-handle, &:focus-within .designer-outline-row-handle': {
          color: canDrag ? '#94A3B8' : '#E2E8F0',
        },
      }}
    >
      {editing && (
        <Tooltip title={canReorder ? t('designerDragHandle') : t('designerReorderLockedTooltip')}>
          <Box
            component="span"
            className="designer-outline-row-handle"
            data-testid={`designer-outline-handle-${id}`}
            aria-label={canReorder ? t('designerDragHandle') : t('designerReorderLockedTooltip')}
            sx={{
              display: 'flex', flexShrink: 0, alignItems: 'center', ml: '-2px',
              color: 'transparent', cursor: canDrag ? 'grab' : 'not-allowed',
            }}
          >
            <GripVertical size={13} />
          </Box>
        </Tooltip>
      )}
      <Box
        component="span"
        aria-label={iconLabel}
        sx={{ display: 'flex', flexShrink: 0, color: selected ? TEAL : '#94A3B8', opacity: suppressed ? 0.5 : 1 }}
      >
        <Icon size={15} />
      </Box>
      <Typography
        noWrap
        sx={{
          fontSize: 12.5, flexGrow: 1, minWidth: 0,
          fontWeight: selected ? 650 : 480,
          color: selected ? TEAL : 'text.primary',
          opacity: suppressed ? 0.5 : 1,
          textDecoration: suppressed ? 'line-through' : 'none',
        }}
      >
        {label}
      </Typography>
      {suppressed && (
        <Box
          component="span"
          aria-label={t('designerSuppressedBadge')}
          sx={{ display: 'flex', flexShrink: 0, color: SUPPRESSED_BADGE.text }}
        >
          <EyeOff size={12} />
        </Box>
      )}
      {tenant && (
        <Tooltip title={t('designerTenantInsertBadge')}>
          <Box
            component="span"
            data-testid={`designer-outline-tenant-${id}`}
            aria-label={t('designerTenantInsertBadge')}
            sx={{
              flexShrink: 0, fontSize: 8, fontWeight: 700, fontFamily: MONO_FONT,
              color: TENANT_BADGE.text, bgcolor: TENANT_BADGE.bg,
              border: `1px solid ${TENANT_BADGE.border}`, borderRadius: '3px', px: '3px', lineHeight: 1.4,
            }}
          >
            T
          </Box>
        </Tooltip>
      )}
      {visibleIf && <VisibleIfBadge expression={visibleIf} sx={{ flexShrink: 0 }} />}
      {canReorder && canAddInto && onAdd && (
        <Tooltip title={t('designerAddInto')}>
          <IconButton
            className="designer-outline-row-action"
            size="small"
            data-testid={`designer-outline-add-${id}`}
            aria-label={t('designerAddInto')}
            onClick={(e) => { e.stopPropagation(); onAdd({ anchor: id, position: 'appendInto', section }); }}
            sx={{ flexShrink: 0, p: '2px', color: TEAL, opacity: 0 }}
          >
            <Plus size={13} />
          </IconButton>
        </Tooltip>
      )}
      {editing && (
        <IconButton
          className="designer-outline-row-action"
          size="small"
          aria-label={suppressed ? t('designerRestore') : t('designerDelete')}
          onClick={(e) => { e.stopPropagation(); if (suppressed) editing.restore(id); else editing.remove(id); }}
          sx={{ flexShrink: 0, p: '2px', ml: '-2px', color: '#94A3B8', opacity: 0 }}
        >
          {suppressed ? <RotateCcw size={13} /> : <Trash2 size={13} />}
        </IconButton>
      )}
    </Box>
  );
}

// ─── Recursive element rows ───────────────────────────────────────────────────

interface ElementRowsProps {
  node: ReportElementNode;
  depth: number;
  /** Sibling array this node lives in (drag-reorder scope). */
  parentId: string;
  /** This node's index within `parentId`'s array. */
  index: number;
  /** Section owning this subtree (header/body/footer). */
  section: 'header' | 'body' | 'footer';
  lang: DesignerLanguage;
  selectedId: string;
  onSelect: (id: string) => void;
  t: (key: string) => string;
  editing?: DesignerEditing;
  drag: DragInfo | null;
  setDrag: (d: DragInfo | null) => void;
  onAdd?: (target: InsertTarget) => void;
}

/** Element types whose `children` array accepts an inline add-into (standard mode). */
function acceptsChildren(node: ReportElementNode): boolean {
  return node.type === 'container' || node.type === 'row' || node.type === 'column';
}

function ElementRows({
  node, depth, parentId, index, section, lang, selectedId, onSelect, t, editing, drag, setDrag, onAdd,
}: ElementRowsProps) {
  return (
    <>
      <OutlineRow
        id={node.id}
        icon={TYPE_ICONS[node.type]}
        iconLabel={t(`elementType.${node.type}`)}
        label={elementLabel(node, lang)}
        depth={depth}
        visibleIf={node.visibleIf}
        selected={selectedId === node.id}
        onSelect={onSelect}
        editing={editing}
        parentId={parentId}
        index={index}
        section={section}
        drag={drag}
        setDrag={setDrag}
        canAddInto={acceptsChildren(node)}
        onAdd={onAdd}
      />
      {childElements(node).map((child, i) => (
        <ElementRows
          key={child.id} node={child} depth={depth + 1}
          parentId={node.id} index={i} section={section}
          lang={lang} selectedId={selectedId} onSelect={onSelect} t={t} editing={editing}
          drag={drag} setDrag={setDrag} onAdd={onAdd}
        />
      ))}
      {node.type === 'keyValueGrid' && node.pairs.map((pair, i) => (
        <OutlineRow
          key={pair.id}
          id={pair.id}
          icon={Equal}
          iconLabel={t('designerTypePair')}
          label={resolveLocalized(pair.label, lang) || pair.id}
          depth={depth + 1}
          selected={selectedId === pair.id}
          onSelect={onSelect}
          editing={editing}
          parentId={node.id}
          index={i}
          section={section}
          drag={drag}
          setDrag={setDrag}
        />
      ))}
      {node.type === 'table' && node.columns.map((column, i) => (
        <OutlineRow
          key={column.id}
          id={column.id}
          icon={Columns3}
          iconLabel={t('designerTypeTableColumn')}
          label={resolveLocalized(column.header, lang) || column.id}
          depth={depth + 1}
          selected={selectedId === column.id}
          onSelect={onSelect}
          editing={editing}
          parentId={node.id}
          index={i}
          section={section}
          drag={drag}
          setDrag={setDrag}
        />
      ))}
    </>
  );
}

// ─── Collapsible group ────────────────────────────────────────────────────────

interface OutlineGroupProps {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
  /** Right-aligned header slot (e.g. the Body add-block button in overlay mode). */
  action?: React.ReactNode;
}

function OutlineGroup({ icon: Icon, title, children, action }: OutlineGroupProps) {
  const [open, setOpen] = useState(true);
  return (
    <Box>
      <Box
        role="button"
        onClick={() => setOpen((o) => !o)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 0.75,
          px: 0.75, pt: '7px', pb: '5px', cursor: 'pointer', userSelect: 'none',
          color: '#475569',
        }}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Icon size={14} />
        <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {title}
        </Typography>
        {action && <Box sx={{ ml: 'auto', display: 'flex' }} onClick={(e) => e.stopPropagation()}>{action}</Box>}
      </Box>
      {open && <Box sx={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>{children}</Box>}
    </Box>
  );
}

// ─── Outline panel ────────────────────────────────────────────────────────────

export interface DesignerOutlineProps {
  doc: ReportDefinitionDoc;
  lang: DesignerLanguage;
  selectedId: string;
  onSelect: (id: string) => void;
  /** Tenant-overlay editing gestures; undefined ⇒ read-only (slice A). */
  editing?: DesignerEditing;
  /** The current overlay, so the add-block dialog avoids pending insert-patch ids. */
  overlay?: ReportOverlayDoc;
}

/** Top-of-body insert target — a new top-level block appends into the body sequence. */
const BODY_INSERT_TARGET: InsertTarget = {
  anchor: BODY_PSEUDO_ANCHOR, position: 'appendInto', section: 'body',
};

export default function DesignerOutline({ doc, lang, selectedId, onSelect, editing, overlay }: DesignerOutlineProps) {
  const t = useDesignerT();
  const settingsSelected = selectedId === REPORT_SETTINGS_ID;
  const settingsRef = useRef<HTMLDivElement | null>(null);
  // The resolved add target (null ⇒ dialog closed); the Body group adds to $body,
  // a container row adds into its own children (standard-mode add-into).
  const [addTarget, setAddTarget] = useState<InsertTarget | null>(null);
  // Shared drag state so a drag started on one row previews on its siblings.
  const [drag, setDrag] = useState<DragInfo | null>(null);

  useEffect(() => {
    if (settingsSelected) settingsRef.current?.scrollIntoView({ block: 'nearest' });
  }, [settingsSelected]);

  return (
    <Box sx={{ p: '10px 8px 24px' }}>
      {/* Report settings pseudo-node */}
      <Box
        ref={settingsRef}
        data-testid="designer-outline-report-settings"
        onClick={() => onSelect(REPORT_SETTINGS_ID)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1,
          p: '8px 10px', mb: 1, borderRadius: '8px', cursor: 'pointer', userSelect: 'none',
          bgcolor: settingsSelected ? TEAL_BG : '#F8FAFC',
          boxShadow: settingsSelected ? `inset 0 0 0 1px ${TEAL_RING}` : 'inset 0 0 0 1px #E2E8F0',
        }}
      >
        <Box component="span" sx={{ display: 'flex', flexShrink: 0, color: settingsSelected ? TEAL : '#475569' }}>
          <Settings size={15} aria-label={t('designerOutlineReportSettings')} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 650, color: settingsSelected ? TEAL : 'text.primary' }}>
            {t('designerOutlineReportSettings')}
          </Typography>
          <Typography noWrap sx={{ fontSize: 10.5, fontFamily: MONO_FONT, color: '#94A3B8' }}>
            {doc.key} · v{doc.version}
          </Typography>
        </Box>
      </Box>

      {doc.pageHeader && (
        <OutlineGroup icon={PanelTop} title={t('designerOutlinePageHeader')}>
          <ElementRows
            node={doc.pageHeader} depth={0} parentId="header" index={0} section="header"
            lang={lang} selectedId={selectedId} onSelect={onSelect} t={t} editing={editing}
            drag={drag} setDrag={setDrag} onAdd={setAddTarget}
          />
        </OutlineGroup>
      )}

      <OutlineGroup
        icon={FileText}
        title={t('designerOutlineBody')}
        action={editing && (
          <Tooltip title={t('designerAddBlock')}>
            <IconButton
              size="small"
              aria-label={t('designerAddBlock')}
              onClick={() => setAddTarget(BODY_INSERT_TARGET)}
              sx={{ p: '2px', color: TEAL }}
            >
              <Plus size={14} />
            </IconButton>
          </Tooltip>
        )}
      >
        {(doc.body ?? []).map((node, i) => (
          <ElementRows
            key={node.id} node={node} depth={0} parentId="body" index={i} section="body"
            lang={lang} selectedId={selectedId} onSelect={onSelect} t={t} editing={editing}
            drag={drag} setDrag={setDrag} onAdd={setAddTarget}
          />
        ))}
      </OutlineGroup>

      {doc.pageFooter && (
        <OutlineGroup icon={PanelBottom} title={t('designerOutlinePageFooter')}>
          <ElementRows
            node={doc.pageFooter} depth={0} parentId="footer" index={0} section="footer"
            lang={lang} selectedId={selectedId} onSelect={onSelect} t={t} editing={editing}
            drag={drag} setDrag={setDrag} onAdd={setAddTarget}
          />
        </OutlineGroup>
      )}

      {editing && (
        <AddBlockDialog
          open={addTarget !== null}
          onClose={() => setAddTarget(null)}
          target={addTarget ?? BODY_INSERT_TARGET}
          editing={editing}
          doc={doc}
          overlay={overlay}
          onAdded={onSelect}
        />
      )}
    </Box>
  );
}
