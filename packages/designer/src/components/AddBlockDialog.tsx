'use client';

/**
 * Issue #2163 — the "Add block" palette dialog (tenant-overlay editing, slice B).
 *
 * Lists the block palette; on pick it builds a minimal valid element skeleton with
 * a fresh id (via `nextId` against every known id) and compiles a tenant `insert`
 * op through `editing.insert`. `pageNumber` is engine-limited to the page header and
 * footer, so it is disabled whenever the resolved insert target is the body.
 */

import { useMemo } from 'react';
import {
  Box, Button, Dialog, DialogContent, DialogTitle, Tooltip, Typography,
} from '@mui/material';
import { useDesignerT } from '../designerContext';
import {
  type ReportDefinitionDoc, type ReportElementType,
} from '@platen-reports/model';
import {
  collectAllIds, nextId, type ReportOverlayDoc,
} from '@platen-reports/model';
import type { DesignerEditing, InsertTarget } from '@platen-reports/model';
import { TENANT_BADGE, TYPE_ICONS } from './designerConstants';

/** Palette order mirrors the design handoff (`report_designer/app.jsx` BLOCK_TYPES). */
const PALETTE: ReportElementType[] = [
  'container', 'keyValueGrid', 'table', 'field', 'text', 'image',
  'row', 'column', 'line', 'spacer', 'pageNumber',
];

/** Id prefix per element type (stable public contract; never regenerated). */
const TYPE_PREFIX: Record<ReportElementType, string> = {
  text: 'txt', field: 'fld', container: 'box', keyValueGrid: 'kvg', table: 'tbl',
  image: 'img', row: 'row', column: 'col', line: 'lin', spacer: 'spc', pageNumber: 'pgn',
};

/**
 * A minimal valid skeleton for `type`, with fresh ids taken from `taken` (the id
 * is accumulated back into the set so a multi-id skeleton never self-collides).
 */
function buildSkeleton(type: ReportElementType, taken: Set<string>): Record<string, unknown> {
  const freshId = (prefix: string): string => {
    const id = nextId(prefix, taken);
    taken.add(id);
    return id;
  };
  const id = freshId(TYPE_PREFIX[type]);
  switch (type) {
    case 'text':
      return { id, type, text: { en: 'New text' } };
    case 'field':
      return { id, type, path: '' };
    case 'container':
      return { id, type, title: { en: 'New section' }, children: [] };
    case 'keyValueGrid':
      return { id, type, pairs: [{ id: freshId('kvp'), label: { en: 'Label' }, path: '' }] };
    case 'table':
      return { id, type, bind: '', columns: [{ id: freshId('col'), header: { en: 'Column' }, path: '' }] };
    case 'image':
      return { id, type, source: 'tenantLogo', height: 24 };
    case 'row':
      return { id, type, children: [] };
    case 'column':
      return { id, type, children: [] };
    case 'line':
      return { id, type, thickness: 0.5 };
    case 'spacer':
      return { id, type, height: 8 };
    case 'pageNumber':
      return { id, type, template: '{page} / {total}' };
    default:
      return { id, type };
  }
}

export interface AddBlockDialogProps {
  open: boolean;
  onClose: () => void;
  /** Where the new element is inserted (resolved by the caller / shell). */
  target: InsertTarget;
  editing: DesignerEditing;
  /** The merged display doc — every element/column/pair id, for collision-free nextId. */
  doc: ReportDefinitionDoc;
  /** The current overlay, so pending insert-patch ids are also avoided. */
  overlay?: ReportOverlayDoc;
  /** Selects the newly inserted element after a pick. */
  onAdded?: (id: string) => void;
}

export default function AddBlockDialog({
  open, onClose, target, editing, doc, overlay, onAdded,
}: AddBlockDialogProps) {
  const t = useDesignerT();
  const takenIds = useMemo(() => collectAllIds(doc, overlay ?? {}), [doc, overlay]);

  const pick = (type: ReportElementType) => {
    // Fresh working copy so repeated opens never reuse a mutated set.
    const skeleton = buildSkeleton(type, new Set(takenIds));
    const newId = editing.insert(skeleton, target);
    onAdded?.(newId);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 0.5, fontSize: 16, fontWeight: 700 }}>
        {t('designerAddBlock')}
      </DialogTitle>
      <DialogContent sx={{ pb: 2 }}>
        <Typography sx={{ fontSize: 12, color: TENANT_BADGE.text, mb: 1.5 }}>
          {t('designerAddBlockNote')}
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
          {PALETTE.map((type) => {
            const Icon = TYPE_ICONS[type];
            const disabled = type === 'pageNumber' && target.section === 'body';
            const button = (
              <Button
                fullWidth
                disableElevation
                variant="outlined"
                color="inherit"
                disabled={disabled}
                onClick={() => pick(type)}
                startIcon={<Icon size={16} />}
                sx={{
                  justifyContent: 'flex-start', textTransform: 'none', px: 1.25, py: 1,
                  borderColor: '#E2E8F0', color: 'text.primary', fontSize: 13, fontWeight: 600,
                  '&:hover': { borderColor: '#CBD5E1', bgcolor: '#F8FAFC' },
                }}
              >
                {t(`elementType.${type}`)}
              </Button>
            );
            return (
              <Box key={type}>
                {disabled ? (
                  <Tooltip title={t('designerPageNumberNote')}>
                    {/* Tooltip needs an enabled wrapper to surface on a disabled button. */}
                    <Box component="span" sx={{ display: 'block' }}>{button}</Box>
                  </Tooltip>
                ) : (
                  button
                )}
              </Box>
            );
          })}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
