'use client';

/**
 * Issue #2162 — designer-local shared constants and micro-primitives.
 *
 * Single source for the element-type icon/label maps and the design tokens from
 * `docs/design_handoff_report_designer/README.md` §Design tokens. Consolidates
 * copies that previously lived (and diverged) in DesignerOutline,
 * DesignerCanvas, and DesignerInspector.
 */

import { Box, Tooltip } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import {
  Columns2, Hash, Image as ImageIcon, LayoutGrid, type LucideIcon, Minus,
  MoveVertical, Rows2, Square, Table2, Type, Variable,
} from 'lucide-react';
import type { ReportElementType } from '@platen-reports/model';

// ─── Design tokens ────────────────────────────────────────────────────────────

export const TEAL = '#0F766E';
export const TEAL_BG = '#F0FDFA';
export const TEAL_RING = '#99F6E4';
export const TEAL_HOVER = '#5EEAD4';

/** Binding/template violet (path chips, Scriban spans). */
export const VIOLET = '#5B21B6';
export const VIOLET_BG = '#F5F3FF';
export const VIOLET_BORDER = '#DDD6FE';
/** STANDARD badge text — lighter than the binding violet per the token sheet. */
export const STANDARD_BADGE_VIOLET = '#7C3AED';

/** Tenant amber (CUSTOMIZED badge / overlay chrome) per the token sheet. */
export const TENANT_BADGE = { text: '#B45309', bg: '#FFFBEB', border: '#FDE68A' } as const;

/** Suppressed/problems red (SUPPRESSED badge / suppressed-row chrome) per the token sheet. */
export const SUPPRESSED_BADGE = { text: '#B91C1C', bg: '#FEF2F2', border: '#FECACA' } as const;

/** visibleIf badge blue. */
export const IF_BADGE = { text: '#1D4ED8', bg: '#EFF6FF', border: '#BFDBFE' } as const;

/** The one mono stack for ids, paths, and JSON. */
export const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** Selection / hover rings on canvas elements, table columns, and grid pairs. */
export const SELECTED_RING = `0 0 0 2px ${TEAL}`;
export const HOVER_RING = `0 0 0 1.5px ${TEAL_HOVER}`;

// ─── Element-type maps ────────────────────────────────────────────────────────

/**
 * Semantic icon per element type (prototype `TYPE_ICON`, in lucide). A `row`
 * lays children out horizontally (side-by-side columns visually) and a `column`
 * stacks them vertically — hence the crossed row/column icon mapping.
 */
export const TYPE_ICONS: Record<ReportElementType, LucideIcon> = {
  text: Type,
  field: Variable,
  row: Columns2,
  column: Rows2,
  container: Square,
  table: Table2,
  keyValueGrid: LayoutGrid,
  spacer: MoveVertical,
  line: Minus,
  image: ImageIcon,
  pageNumber: Hash,
};

// ─── VisibleIfBadge ───────────────────────────────────────────────────────────

/**
 * Blue mono `if` badge shown on elements with a `visibleIf` expression — the
 * expression itself is the tooltip and the accessible label. The caller styles
 * placement via `sx` (inline in the outline, absolutely positioned on canvas).
 */
export function VisibleIfBadge({ expression, size = 8.5, sx }: {
  expression: string;
  size?: number;
  sx?: SxProps<Theme>;
}) {
  return (
    <Tooltip title={expression}>
      <Box
        component="span"
        aria-label={expression}
        sx={[
          {
            fontSize: size, fontWeight: 700, fontFamily: MONO_FONT,
            color: IF_BADGE.text, bgcolor: IF_BADGE.bg, border: `1px solid ${IF_BADGE.border}`,
            borderRadius: '3px', px: '3px',
          },
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
      >
        if
      </Box>
    </Tooltip>
  );
}
