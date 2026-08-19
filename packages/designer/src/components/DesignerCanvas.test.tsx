import React from 'react';
import { fireEvent, render as rtlRender, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it , vi} from 'vitest';
import { REPORT_SETTINGS_ID, type ReportDefinitionDoc } from '@platen-reports/model';
import { DesignerTestProvider } from '../test/harness';
import DesignerCanvas from './DesignerCanvas';
import type { DesignerEditing } from '@platen-reports/model';

// ─── Harness ──────────────────────────────────────────────────────────────────

const render = (ui: React.ReactElement) =>
  rtlRender(ui, { wrapper: DesignerTestProvider });


// ─── Fixture: every element type, incl. table columns + grid pairs ────────────

const doc: ReportDefinitionDoc = {
  schemaVersion: 1,
  key: 'asset-print',
  version: '1.0.0',
  page: { size: 'A4', orientation: 'portrait', margin: 28 },
  pageHeader: {
    id: 'hdr',
    type: 'row',
    children: [
      { id: 'hdr-title', type: 'text', text: 'Asset {{ asset.name }}', weight: 3, style: { fontSize: 15, bold: true } },
      { id: 'hdr-logo', type: 'image', source: 'tenantLogo', weight: 1, height: 30 },
    ],
  },
  body: [
    {
      id: 'card-general',
      type: 'container',
      width: 'half',
      title: { en: 'General', nl: 'Algemeen' },
      children: [
        {
          id: 'grid-general',
          type: 'keyValueGrid',
          columns: 2,
          pairs: [
            { id: 'pair-status', label: { en: 'Status' }, path: 'asset.status' },
            { id: 'pair-value', label: { en: 'Value' }, path: 'asset.purchaseValue', format: 'C' },
          ],
        },
      ],
    },
    {
      id: 'col-details',
      type: 'column',
      spacing: 2,
      children: [
        { id: 'fld-serial', type: 'field', path: 'asset.serialNumber', format: 'N2', visibleIf: "[asset.isCritical] = 'Yes'" },
        { id: 'line-sep', type: 'line', thickness: 1 },
        { id: 'spacer-gap', type: 'spacer', height: 12 },
      ],
    },
    {
      id: 'tbl-materials',
      type: 'table',
      bind: 'workOrder.materials',
      groupBy: 'category',
      repeatHeader: false,
      groupTotals: [{ columnId: 'col-qty', aggregate: 'sum' }],
      totals: [{ columnId: 'col-qty', aggregate: 'sum' }],
      columns: [
        { id: 'col-desc', header: { en: 'Description' }, path: 'description' },
        { id: 'col-qty', header: { en: 'Qty' }, path: 'quantity', format: 'N0' },
      ],
    },
  ],
  pageFooter: {
    id: 'ftr',
    type: 'row',
    children: [{ id: 'ftr-page', type: 'pageNumber', template: '{page} / {total}' }],
  },
};

describe('DesignerCanvas', () => {
  const onSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderCanvas = (selectedId: string = REPORT_SETTINGS_ID) =>
    render(<DesignerCanvas doc={doc} lang="en" selectedId={selectedId} onSelect={onSelect} scale={1} />);

  it('renders a field as a violet path chip with its format suffix', () => {
    renderCanvas();

    const field = screen.getByTestId('designer-canvas-el-fld-serial');
    expect(field).toHaveTextContent('asset.serialNumber :N2');
  });

  it('renders Scriban spans in text as inline chips with the braces stripped', () => {
    renderCanvas();

    const text = screen.getByTestId('designer-canvas-el-hdr-title');
    expect(within(text).getByText('asset.name')).toBeInTheDocument();
    expect(text).toHaveTextContent('Asset');
  });

  it('renders table header, column binding chips, and meta chips', () => {
    renderCanvas();

    const table = screen.getByTestId('designer-canvas-el-tbl-materials');
    expect(within(table).getByText('Description')).toBeInTheDocument();
    expect(within(table).getByText('Qty')).toBeInTheDocument();
    expect(within(table).getByText(/quantity/)).toBeInTheDocument();
    // Meta chips: bind, group by, group totals, grand total, header once.
    expect(within(table).getByText('↻ workOrder.materials')).toBeInTheDocument();
    expect(within(table).getByText('designerCanvasGroupBy(category)')).toBeInTheDocument();
    expect(within(table).getByText('designerCanvasGroupTotals')).toBeInTheDocument();
    expect(within(table).getByText('designerCanvasGrandTotal')).toBeInTheDocument();
    expect(within(table).getByText('designerCanvasHeaderOnce')).toBeInTheDocument();
  });

  it('renders spacer and image placeholders', () => {
    renderCanvas();

    const spacer = screen.getByTestId('designer-canvas-el-spacer-gap');
    expect(within(spacer).getByLabelText('elementType.spacer')).toBeInTheDocument();
    // Image placeholder shows the source name.
    expect(screen.getByTestId('designer-canvas-el-hdr-logo')).toHaveTextContent('tenantLogo');
  });

  it('shows the blue if badge with the expression on visibleIf elements', () => {
    renderCanvas();

    const badges = screen.getAllByText('if');
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveAttribute('aria-label', "[asset.isCritical] = 'Yes'");
  });

  it('selects REPORT_SETTINGS_ID when the sheet background is clicked', () => {
    renderCanvas();

    fireEvent.click(screen.getByTestId('designer-canvas-sheet'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(REPORT_SETTINGS_ID);
  });

  it('selects an element on click without bubbling to the sheet', () => {
    renderCanvas();

    fireEvent.click(screen.getByTestId('designer-canvas-el-fld-serial'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('fld-serial');
  });

  it('selects a table column by its own id when its header is clicked', () => {
    renderCanvas();

    fireEvent.click(screen.getByTestId('designer-canvas-el-col-desc'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('col-desc');
  });

  it('selects a keyValueGrid pair by its own id when clicked', () => {
    renderCanvas();

    fireEvent.click(screen.getByTestId('designer-canvas-el-pair-status'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('pair-status');
  });

  it('shows the type tag on the selected element', () => {
    renderCanvas('fld-serial');

    expect(screen.getByText('elementType.field')).toBeInTheDocument();
  });

  it('sizes the sheet with the portrait A4 aspect by default', () => {
    renderCanvas();

    expect(screen.getByTestId('designer-canvas-sheet'))
      .toHaveStyle({ minHeight: `${620 * (297 / 210)}px` });
  });

  it('inverts the sheet aspect for a landscape page (the asset-list layout)', () => {
    const landscapeDoc: ReportDefinitionDoc = {
      ...doc,
      page: { size: 'A4', orientation: 'landscape', margin: 24 },
    };
    render(<DesignerCanvas doc={landscapeDoc} lang="en" selectedId={REPORT_SETTINGS_ID} onSelect={onSelect} scale={1} />);

    // Width stays 620; the height inverts to the short A4 edge.
    expect(screen.getByTestId('designer-canvas-sheet'))
      .toHaveStyle({ minHeight: `${620 * (210 / 297)}px` });
  });

  it('adds a "path · type" tooltip to path chips when fieldTypes knows the path', () => {
    render(
      <DesignerCanvas
        doc={doc} lang="en" selectedId={REPORT_SETTINGS_ID} onSelect={onSelect} scale={1}
        fieldTypes={new Map([['asset.serialNumber', 'string']])}
      />,
    );

    const field = screen.getByTestId('designer-canvas-el-fld-serial');
    // MUI Tooltip stamps the title as aria-label on the (otherwise unnamed) chip.
    expect(within(field).getByLabelText('asset.serialNumber · string')).toBeInTheDocument();
  });

  it('lays out a keyValueGrid without explicit columns two-per-row (server parser default)', () => {
    const kvDoc: ReportDefinitionDoc = {
      ...doc,
      body: [{
        id: 'kv-default',
        type: 'keyValueGrid',
        pairs: [
          { id: 'p-a', label: { en: 'A' }, path: 'asset.a' },
          { id: 'p-b', label: { en: 'B' }, path: 'asset.b' },
        ],
      }],
    };
    render(<DesignerCanvas doc={kvDoc} lang="en" selectedId={REPORT_SETTINGS_ID} onSelect={onSelect} scale={1} />);

    // The pairs' shared parent is the grid — two columns like the real PDF.
    const grid = screen.getByTestId('designer-canvas-el-p-a').parentElement!;
    expect(grid).toBe(screen.getByTestId('designer-canvas-el-p-b').parentElement);
    expect(grid).toHaveStyle({ gridTemplateColumns: 'repeat(2, 1fr)' });
  });

  it('pairs consecutive half-width containers inside a column, like the server sequence renderer', () => {
    const nestedDoc: ReportDefinitionDoc = {
      ...doc,
      body: [{
        id: 'col-halves',
        type: 'column',
        children: [
          { id: 'half-a', type: 'container', width: 'half', children: [] },
          { id: 'half-b', type: 'container', width: 'half', children: [] },
          { id: 'full-c', type: 'container', children: [] },
        ],
      }],
    };
    render(<DesignerCanvas doc={nestedDoc} lang="en" selectedId={REPORT_SETTINGS_ID} onSelect={onSelect} scale={1} />);

    const slotA = screen.getByTestId('designer-canvas-el-half-a').parentElement!;
    const slotB = screen.getByTestId('designer-canvas-el-half-b').parentElement!;
    const slotC = screen.getByTestId('designer-canvas-el-full-c').parentElement!;
    // Halves take one cell each of the same 2-column sequence grid → side by side;
    // the full-width sibling spans both cells.
    expect(slotA.parentElement).toBe(slotB.parentElement);
    expect(slotA).toHaveStyle({ gridColumn: 'span 1' });
    expect(slotB).toHaveStyle({ gridColumn: 'span 1' });
    expect(slotC).toHaveStyle({ gridColumn: 'span 2' });
  });
});

// ─── Tenant overlay editing (slice B) ─────────────────────────────────────────

function makeEditing(overrides: Partial<DesignerEditing> = {}): DesignerEditing {
  return {
    meta: new Map(),
    isOverlayInsert: () => false,
    isSuppressed: () => false,
    touchedProps: () => new Set<string>(),
    setProp: vi.fn(),
    resetProp: vi.fn(),
    remove: vi.fn(),
    restore: vi.fn(),
    insert: vi.fn(() => 'new-id'),
    insertTargetFor: vi.fn(() => ({ anchor: '$body', position: 'appendInto' as const, section: 'body' as const })),
    ...overrides,
  };
}

describe('DesignerCanvas — tenant overlay editing', () => {
  const onSelect = vi.fn();
  beforeEach(() => { vi.clearAllMocks(); });

  it('ghosts a suppressed element with grayscale + a red SUPPRESSED badge', () => {
    const editing = makeEditing({ isSuppressed: (id) => id === 'fld-serial' });
    render(
      <DesignerCanvas doc={doc} lang="en" selectedId={REPORT_SETTINGS_ID} onSelect={onSelect} scale={1} editing={editing} />,
    );

    const field = screen.getByTestId('designer-canvas-el-fld-serial');
    expect(field).toHaveStyle({ opacity: '0.35' });
    expect(field).toHaveStyle({ filter: 'grayscale(1)' });
    expect(within(field).getByText('designerSuppressedBadge')).toBeInTheDocument();
  });

  it('outlines a tenant insert with a dashed amber border + a TENANT badge', () => {
    const editing = makeEditing({ isOverlayInsert: (id) => id === 'fld-serial' });
    render(
      <DesignerCanvas doc={doc} lang="en" selectedId={REPORT_SETTINGS_ID} onSelect={onSelect} scale={1} editing={editing} />,
    );

    const field = screen.getByTestId('designer-canvas-el-fld-serial');
    expect(field).toHaveStyle({ outline: '1.5px dashed #B45309' });
    expect(within(field).getByText('designerTenantInsertBadge')).toBeInTheDocument();
  });

  it('adds no overlay chrome when editing is undefined (slice A parity)', () => {
    render(
      <DesignerCanvas doc={doc} lang="en" selectedId={REPORT_SETTINGS_ID} onSelect={onSelect} scale={1} />,
    );

    const field = screen.getByTestId('designer-canvas-el-fld-serial');
    expect(field).not.toHaveStyle({ filter: 'grayscale(1)' });
    expect(screen.queryByText('designerSuppressedBadge')).not.toBeInTheDocument();
    expect(screen.queryByText('designerTenantInsertBadge')).not.toBeInTheDocument();
  });
});
