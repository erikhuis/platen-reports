import React from 'react';
import { fireEvent, render as rtlRender, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it , vi} from 'vitest';
import { REPORT_SETTINGS_ID, type ReportDefinitionDoc } from '@platen-reports/model';
import { DesignerTestProvider } from '../test/harness';
import DesignerOutline from './DesignerOutline';
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

describe('DesignerOutline', () => {
  const onSelect = vi.fn();
  let scrollSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    scrollSpy = vi.spyOn(window.HTMLElement.prototype, 'scrollIntoView');
  });

  afterEach(() => {
    scrollSpy.mockRestore();
  });

  const renderOutline = (selectedId: string = REPORT_SETTINGS_ID) =>
    render(<DesignerOutline doc={doc} lang="en" selectedId={selectedId} onSelect={onSelect} />);

  it('renders the report-settings pseudo-node with key and version', () => {
    renderOutline();

    expect(screen.getByText('designerOutlineReportSettings')).toBeInTheDocument();
    expect(screen.getByText('asset-print · v1.0.0')).toBeInTheDocument();
  });

  it('renders the three groups and one row per element, recursively', () => {
    renderOutline();

    expect(screen.getByText('designerOutlinePageHeader')).toBeInTheDocument();
    expect(screen.getByText('designerOutlineBody')).toBeInTheDocument();
    expect(screen.getByText('designerOutlinePageFooter')).toBeInTheDocument();

    // Meaningful labels: text (braces stripped), field path, container title, table bind.
    expect(screen.getByText('Asset asset.name')).toBeInTheDocument();
    expect(screen.getByText('asset.serialNumber')).toBeInTheDocument();
    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('workOrder.materials')).toBeInTheDocument();
    // Structural elements fall back to their id.
    expect(screen.getByText('hdr')).toBeInTheDocument();
    expect(screen.getByText('col-details')).toBeInTheDocument();
    expect(screen.getByText('line-sep')).toBeInTheDocument();
    expect(screen.getByText('spacer-gap')).toBeInTheDocument();
    expect(screen.getByText('ftr-page')).toBeInTheDocument();
  });

  it('renders keyValueGrid pairs and table columns as child rows', () => {
    renderOutline();

    // Pairs by resolved label.
    expect(screen.getByTestId('designer-outline-row-pair-status')).toHaveTextContent('Status');
    expect(screen.getByTestId('designer-outline-row-pair-value')).toHaveTextContent('Value');
    // Table columns by resolved header.
    expect(screen.getByTestId('designer-outline-row-col-desc')).toHaveTextContent('Description');
    expect(screen.getByTestId('designer-outline-row-col-qty')).toHaveTextContent('Qty');
  });

  it('shows a blue if chip only for elements with visibleIf, labelled with the expression', () => {
    renderOutline();

    const chips = screen.getAllByText('if');
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveAttribute('aria-label', "[asset.isCritical] = 'Yes'");
  });

  it('fires onSelect with pair, column, element, and report-settings ids', () => {
    renderOutline();

    fireEvent.click(screen.getByTestId('designer-outline-row-pair-status'));
    expect(onSelect).toHaveBeenLastCalledWith('pair-status');

    fireEvent.click(screen.getByTestId('designer-outline-row-col-qty'));
    expect(onSelect).toHaveBeenLastCalledWith('col-qty');

    fireEvent.click(screen.getByTestId('designer-outline-row-fld-serial'));
    expect(onSelect).toHaveBeenLastCalledWith('fld-serial');

    fireEvent.click(screen.getByTestId('designer-outline-report-settings'));
    expect(onSelect).toHaveBeenLastCalledWith(REPORT_SETTINGS_ID);
  });

  it('collapses a group when its header is clicked', () => {
    renderOutline();

    expect(screen.getByTestId('designer-outline-row-ftr-page')).toBeInTheDocument();
    fireEvent.click(screen.getByText('designerOutlinePageFooter'));
    expect(screen.queryByTestId('designer-outline-row-ftr-page')).not.toBeInTheDocument();
  });

  it('scrolls the newly selected row into view when selectedId changes from outside', () => {
    const { rerender } = renderOutline();
    scrollSpy.mockClear();

    rerender(<DesignerOutline doc={doc} lang="en" selectedId="col-qty" onSelect={onSelect} />);

    expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('renders no trash, tenant chip, or add-block affordance in read-only mode', () => {
    renderOutline();

    expect(screen.queryByRole('button', { name: 'designerDelete' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'designerAddBlock' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('designer-outline-tenant-card-general')).not.toBeInTheDocument();
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
    insert: vi.fn((element: Record<string, unknown>) => element.id as string),
    insertTargetFor: vi.fn(() => ({ anchor: '$body', position: 'appendInto' as const, section: 'body' as const })),
    ...overrides,
  };
}

describe('DesignerOutline — tenant overlay editing', () => {
  const onSelect = vi.fn();
  beforeEach(() => { vi.clearAllMocks(); });

  const renderEditing = (editing: DesignerEditing, selectedId = REPORT_SETTINGS_ID) =>
    render(<DesignerOutline doc={doc} lang="en" selectedId={selectedId} onSelect={onSelect} editing={editing} />);

  it('strikes through a suppressed row and offers a Restore instead of a trash', () => {
    const editing = makeEditing({ isSuppressed: (id) => id === 'fld-serial' });
    renderEditing(editing);

    const row = screen.getByTestId('designer-outline-row-fld-serial');
    expect(within(row).getByText('asset.serialNumber')).toHaveStyle({ textDecoration: 'line-through' });
    // Eye-off marker present.
    expect(within(row).getByLabelText('designerSuppressedBadge')).toBeInTheDocument();

    // Restore (not delete) is shown for a suppressed standard row.
    expect(within(row).queryByRole('button', { name: 'designerDelete' })).not.toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'designerRestore' }));
    expect(editing.restore).toHaveBeenCalledWith('fld-serial');
  });

  it('shows an amber T chip on a tenant-inserted row', () => {
    const editing = makeEditing({ isOverlayInsert: (id) => id === 'card-general' });
    renderEditing(editing);

    const chip = screen.getByTestId('designer-outline-tenant-card-general');
    expect(chip).toHaveTextContent('T');
  });

  it('calls remove when a row trash is clicked', () => {
    const editing = makeEditing();
    renderEditing(editing);

    const row = screen.getByTestId('designer-outline-row-fld-serial');
    fireEvent.click(within(row).getByRole('button', { name: 'designerDelete' }));
    expect(editing.remove).toHaveBeenCalledWith('fld-serial');
  });

  it('opens the add-block dialog from the Body group affordance', async () => {
    const editing = makeEditing();
    renderEditing(editing);

    expect(screen.queryByText('designerAddBlockNote')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'designerAddBlock' }));
    expect(await screen.findByText('designerAddBlockNote')).toBeInTheDocument();
  });

  it('is not draggable and shows the reorder-locked handle in tenant mode', () => {
    const editing = makeEditing();
    renderEditing(editing);

    const row = screen.getByTestId('designer-outline-row-fld-serial');
    expect(row).not.toHaveAttribute('draggable');

    const handle = within(row).getByLabelText('designerReorderLockedTooltip');
    expect(handle).toBeInTheDocument();
    expect(handle).toHaveStyle({ cursor: 'not-allowed' });
  });
});

// ─── Standard-mode drag-reorder (slice C) ─────────────────────────────────────

function makeStandardEditing(overrides: Partial<DesignerEditing> = {}): DesignerEditing {
  return makeEditing({ mode: 'definition', canEditStructure: () => true, reorder: vi.fn(), ...overrides });
}

/** Minimal DataTransfer stub for fireEvent drag events. */
function makeDataTransfer(): DataTransfer {
  const store: Record<string, string> = {};
  return {
    effectAllowed: 'uninitialized',
    dropEffect: 'none',
    setData: (k: string, v: string) => { store[k] = v; },
    getData: (k: string) => store[k] ?? '',
    setDragImage: () => {},
  } as unknown as DataTransfer;
}

/** Force a deterministic rect on a row so drop-side maths is stable in jsdom. */
function stubRect(el: Element, top: number, height: number): void {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}),
  } as DOMRect);
}

/**
 * jsdom's synthetic drag events drop `clientY`, so dispatch a real MouseEvent named
 * `drop` (which carries clientY) at the target; the handler guards the absent
 * `dataTransfer`. Above the row's vertical midpoint drops "before", below "after".
 */
function fireDropAt(target: HTMLElement, clientY: number): void {
  stubRect(target, 0, 20); // midpoint = 10
  fireEvent(target, new MouseEvent('drop', { bubbles: true, clientY }));
}

describe('DesignerOutline — standard-mode drag-reorder', () => {
  const onSelect = vi.fn();
  beforeEach(() => { vi.clearAllMocks(); });

  const renderStandard = (editing: DesignerEditing, selectedId = REPORT_SETTINGS_ID) =>
    render(<DesignerOutline doc={doc} lang="en" selectedId={selectedId} onSelect={onSelect} editing={editing} />);

  it('marks rows draggable and shows an active drag handle in standard mode', () => {
    const editing = makeStandardEditing();
    renderStandard(editing);

    const row = screen.getByTestId('designer-outline-row-fld-serial');
    expect(row).toHaveAttribute('draggable', 'true');

    const handle = within(row).getByLabelText('designerDragHandle');
    expect(handle).toHaveStyle({ cursor: 'grab' });
  });

  it('calls reorder(parentId, from, to) when dropping below a later sibling', () => {
    const reorder = vi.fn();
    renderStandard(makeStandardEditing({ reorder }));

    // Drag fld-serial (index 0) onto spacer-gap (index 2), dropping in the lower half.
    const source = screen.getByTestId('designer-outline-row-fld-serial');
    const target = screen.getByTestId('designer-outline-row-spacer-gap');

    fireEvent.dragStart(source, { dataTransfer: makeDataTransfer() });
    fireDropAt(target, 15); // below midpoint → after

    // insertAt = 2 + 1 = 3; post-removal toIndex = 3 - 1 = 2.
    expect(reorder).toHaveBeenCalledTimes(1);
    expect(reorder).toHaveBeenCalledWith('col-details', 0, 2);
  });

  it('calls reorder with the before-index when dropping above an earlier sibling', () => {
    const reorder = vi.fn();
    renderStandard(makeStandardEditing({ reorder }));

    // Drag spacer-gap (index 2) onto fld-serial (index 0), dropping in the upper half.
    const source = screen.getByTestId('designer-outline-row-spacer-gap');
    const target = screen.getByTestId('designer-outline-row-fld-serial');

    fireEvent.dragStart(source, { dataTransfer: makeDataTransfer() });
    fireDropAt(target, 5); // above midpoint → before

    // insertAt = 0; toIndex = 0 (0 is not > from 2).
    expect(reorder).toHaveBeenCalledWith('col-details', 2, 0);
  });

  it('does NOT reorder on a cross-parent drop', () => {
    const reorder = vi.fn();
    renderStandard(makeStandardEditing({ reorder }));

    // fld-serial lives in col-details; card-general lives in body — different arrays.
    const source = screen.getByTestId('designer-outline-row-fld-serial');
    const target = screen.getByTestId('designer-outline-row-card-general');

    fireEvent.dragStart(source, { dataTransfer: makeDataTransfer() });
    fireDropAt(target, 15);

    expect(reorder).not.toHaveBeenCalled();
  });

  it('reorders table columns within their table (child sibling array)', () => {
    const reorder = vi.fn();
    renderStandard(makeStandardEditing({ reorder }));

    // Drag col-desc (index 0) onto col-qty (index 1), lower half → after.
    const source = screen.getByTestId('designer-outline-row-col-desc');
    const target = screen.getByTestId('designer-outline-row-col-qty');

    fireEvent.dragStart(source, { dataTransfer: makeDataTransfer() });
    fireDropAt(target, 15);

    // insertAt = 1 + 1 = 2; toIndex = 2 - 1 = 1.
    expect(reorder).toHaveBeenCalledWith('tbl-materials', 0, 1);
  });

  it('adds a block into a container row via the inline add-into affordance', async () => {
    const insert = vi.fn((el: Record<string, unknown>) => el.id as string);
    renderStandard(makeStandardEditing({ insert }));

    fireEvent.click(screen.getByTestId('designer-outline-add-card-general'));
    fireEvent.click(await screen.findByRole('button', { name: 'elementType.field' }));

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'field' }),
      { anchor: 'card-general', position: 'appendInto', section: 'body' },
    );
  });
});
