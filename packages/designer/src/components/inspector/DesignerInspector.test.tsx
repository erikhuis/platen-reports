import React from 'react';
import { render as rtlRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it , vi} from 'vitest';
import DesignerInspector from './DesignerInspector';
import type { DesignerEditing, DesignerSettingsEditing, InsertTarget } from '@platen-reports/model';
import { REPORT_SETTINGS_ID, type ReportDefinitionDoc } from '@platen-reports/model';
import { DesignerIntlTestProvider } from '../../test/harness';

// The designer reads its translator from ReportDesignerProvider (#2444); this harness
// feeds it the package's own English bundle — so
// these assertions also pin that the designer* keys exist.
const render = (ui: React.ReactElement) =>
  rtlRender(ui, { wrapper: DesignerIntlTestProvider });

const doc: ReportDefinitionDoc = {
  schemaVersion: 1,
  key: 'asset-print',
  version: '1.2.0',
  title: { en: 'Asset card', nl: 'Activumkaart' },
  dataSource: 'assets',
  requiredPermission: 'Assets.View',
  page: { size: 'A4', orientation: 'landscape', margin: 28 },
  defaultStyle: { fontSize: 8 },
  parameters: [{ name: 'assetId', type: 'guid', required: true }],
  body: [
    // Style override → the Style accordion must show the teal "1 changed" pill.
    { id: 'txt-1', type: 'text', text: { en: 'Hello' }, style: { fontSize: 12 } },
    // No overrides at all → every shared accordion shows the gray "defaults" badge.
    { id: 'txt-2', type: 'text', text: 'Plain' },
    { id: 'fld-1', type: 'field', path: 'asset.purchaseCost', format: 'N2' },
    {
      id: 'tbl-1',
      type: 'table',
      bind: 'workOrders',
      columns: [{ id: 'col-1', header: { en: 'Cost' }, path: 'cost', format: 'N2', align: 'right' }],
    },
  ],
};

function renderInspector(selectedId: string, lang: 'en' | 'nl' | 'de' | 'es' = 'en') {
  return render(<DesignerInspector doc={doc} lang={lang} selectedId={selectedId} />);
}

describe('DesignerInspector', () => {
  it('renders the report settings view with key, version and parameters', () => {
    renderInspector(REPORT_SETTINGS_ID);

    expect(screen.getByTestId('inspector-type-label')).toHaveTextContent('Report settings');
    // Key appears in the header id slot and in Identity & access.
    expect(screen.getAllByText('asset-print').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('1.2.0')).toBeInTheDocument();
    expect(screen.getByText('Assets.View')).toBeInTheDocument();
    // Parameter list: name · type · required.
    expect(screen.getByText('assetId')).toBeInTheDocument();
    expect(screen.getByText('guid')).toBeInTheDocument();
    expect(screen.getByText('required')).toBeInTheDocument();
    // Page setup: landscape ≠ portrait, margin 28 ≠ the server-parser default 24,
    // and an explicit defaultStyle.fontSize all count as changes.
    expect(screen.getByText('landscape')).toBeInTheDocument();
    expect(screen.getByText('3 changed')).toBeInTheDocument();
  });

  it('shows the document base font from defaultStyle.fontSize, not the element default', () => {
    renderInspector(REPORT_SETTINGS_ID);

    expect(screen.getByText('8')).toBeInTheDocument();
    // The un-overridden element default (9) is not what Page setup displays.
    expect(screen.queryByText('9')).not.toBeInTheDocument();
  });

  it('shows path and format for a selected field element', () => {
    renderInspector('fld-1');

    expect(screen.getByTestId('inspector-type-label')).toHaveTextContent('Field');
    expect(screen.getByTestId('inspector-element-id')).toHaveTextContent('fld-1');
    expect(screen.getByText('asset.purchaseCost')).toBeInTheDocument();
    expect(screen.getByText('N2')).toBeInTheDocument();
  });

  it('shows header, value and alignment for a selected table column', () => {
    renderInspector('col-1');

    expect(screen.getByTestId('inspector-type-label')).toHaveTextContent('Table column');
    expect(screen.getByTestId('inspector-element-id')).toHaveTextContent('col-1');
    expect(screen.getByText('Cost')).toBeInTheDocument();
    expect(screen.getByText('cost')).toBeInTheDocument();
    // Column layout advanced section: align=right is an override.
    expect(screen.getByText('Right')).toBeInTheDocument();
    expect(screen.getByText('1 changed')).toBeInTheDocument();
  });

  it('badges the Style accordion with "1 changed" for an overridden fontSize and "defaults" otherwise', () => {
    const view = renderInspector('txt-1');
    // Only style.fontSize (12 ≠ default 9) differs — exactly one changed-pill.
    expect(screen.getAllByText('1 changed')).toHaveLength(1);
    // Layout in row + Visibility are untouched.
    expect(screen.getAllByText('defaults').length).toBeGreaterThanOrEqual(2);

    view.rerender(<DesignerInspector doc={doc} lang="en" selectedId="txt-2" />);
    expect(screen.queryByText('1 changed')).not.toBeInTheDocument();
    expect(screen.getAllByText('defaults').length).toBeGreaterThanOrEqual(3);
  });

  it('resolves localized text in the requested language with en fallback', () => {
    const view = renderInspector(REPORT_SETTINGS_ID, 'nl');
    expect(screen.getByText('Activumkaart')).toBeInTheDocument();

    // No de entry → falls back to en.
    view.rerender(<DesignerInspector doc={doc} lang="de" selectedId={REPORT_SETTINGS_ID} />);
    expect(screen.getByText('Asset card')).toBeInTheDocument();
    expect(screen.queryByText('Activumkaart')).not.toBeInTheDocument();
  });

  it('renders the pinned footer legend', () => {
    renderInspector('txt-1');
    expect(
      screen.getByText(/marks a change from the default\. Defaults are never written to the definition\./),
    ).toBeInTheDocument();
  });

  it('shows the field type as a subtle suffix on path rows when fieldTypes is provided', () => {
    const fieldTypes = new Map([
      ['asset.purchaseCost', 'number'],
      ['cost', 'number'],
    ]);
    const view = render(
      <DesignerInspector doc={doc} lang="en" selectedId="fld-1" fieldTypes={fieldTypes} />,
    );
    expect(screen.getByTestId('field-type-suffix')).toHaveTextContent('· number');

    // Table-column value rows get the same suffix through ValueSourceRow.
    view.rerender(<DesignerInspector doc={doc} lang="en" selectedId="col-1" fieldTypes={fieldTypes} />);
    expect(screen.getByTestId('field-type-suffix')).toHaveTextContent('· number');

    // Unknown paths render no suffix (best-effort map).
    view.rerender(<DesignerInspector doc={doc} lang="en" selectedId="fld-1" fieldTypes={new Map()} />);
    expect(screen.queryByTestId('field-type-suffix')).not.toBeInTheDocument();
  });
});

// ─── Editing mode (tenant overlay) ──────────────────────────────────────────

function makeEditing(over: Partial<DesignerEditing> = {}): DesignerEditing {
  return {
    meta: new Map(),
    isOverlayInsert: () => false,
    isSuppressed: () => false,
    touchedProps: () => new Set<string>(),
    setProp: vi.fn(),
    resetProp: vi.fn(),
    remove: vi.fn(),
    restore: vi.fn(),
    insert: vi.fn(() => 'ins-1'),
    insertTargetFor: vi.fn(() => ({ anchor: '$body', position: 'appendInto', section: 'body' })),
    ...over,
  } as DesignerEditing;
}

describe('DesignerInspector (editing mode)', () => {
  it('does not regress read-only behavior when editing is undefined', () => {
    render(<DesignerInspector doc={doc} lang="en" selectedId="fld-1" />);
    // Read-only field body shows the path as static text, no editable input.
    expect(screen.getByText('asset.purchaseCost')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('edits a text prop through LangText and calls setProp with the element default', async () => {
    const user = userEvent.setup();
    const setProp = vi.fn();
    render(<DesignerInspector doc={doc} lang="en" selectedId="txt-2" editing={makeEditing({ setProp })} />);

    const field = screen.getByLabelText('Content in EN');
    await user.type(field, 'X');
    // ELEMENT_DEFAULTS.text has no `text` default → undefined is passed for elision.
    expect(setProp).toHaveBeenCalledWith('txt-2', 'text', 'PlainX', undefined);
  });

  it('shows an override dot + reset for a touched prop and reset calls resetProp', async () => {
    const user = userEvent.setup();
    const resetProp = vi.fn();
    render(
      <DesignerInspector
        doc={doc}
        lang="en"
        selectedId="txt-2"
        editing={makeEditing({ resetProp, touchedProps: () => new Set(['text']) })}
      />,
    );

    expect(screen.getByTestId('override-dot')).toBeInTheDocument();
    await user.click(screen.getByTestId('reset-prop'));
    expect(resetProp).toHaveBeenCalledWith('txt-2', 'text');
  });

  it('locks a standard field path: pointer-events none + lock note', () => {
    render(<DesignerInspector doc={doc} lang="en" selectedId="fld-1" editing={makeEditing()} />);

    const locked = screen.getByTestId('locked-control');
    expect(locked).toHaveStyle('pointer-events: none');
    expect(screen.getByText('The bound field is owned by the standard definition')).toBeInTheDocument();
  });

  it('unlocks the path of a tenant-inserted element', async () => {
    const user = userEvent.setup();
    const setProp = vi.fn();
    render(
      <DesignerInspector
        doc={doc}
        lang="en"
        selectedId="fld-1"
        editing={makeEditing({ setProp, isOverlayInsert: () => true })}
      />,
    );

    // No lock wrapper — the path is directly editable.
    expect(screen.queryByTestId('locked-control')).not.toBeInTheDocument();
    const pathField = screen.getByDisplayValue('asset.purchaseCost');
    await user.type(pathField, 'x');
    expect(setProp).toHaveBeenCalledWith('fld-1', 'path', 'asset.purchaseCostx', undefined);
    // The tenant badge is shown in the header.
    expect(screen.getByTestId('inspector-tenant-badge')).toBeInTheDocument();
  });

  it('shows a "Hidden by this overlay" banner + Restore for a suppressed element', async () => {
    const user = userEvent.setup();
    const restore = vi.fn();
    render(
      <DesignerInspector
        doc={doc}
        lang="en"
        selectedId="txt-2"
        editing={makeEditing({ restore, isSuppressed: () => true })}
      />,
    );

    expect(screen.getByText('Hidden by this overlay.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /restore/i }));
    expect(restore).toHaveBeenCalledWith('txt-2');
  });

  it('keeps Report settings read-only (locked) even in editing mode', () => {
    render(<DesignerInspector doc={doc} lang="en" selectedId={REPORT_SETTINGS_ID} editing={makeEditing()} />);
    expect(screen.getByTestId('locked-control')).toHaveStyle('pointer-events: none');
    // Still shows the standard settings content.
    expect(screen.getByText('1.2.0')).toBeInTheDocument();
  });

  it('offers only "tenantLogo" as the source of an inserted image (no free text)', () => {
    const imageDoc: ReportDefinitionDoc = {
      schemaVersion: 1, key: 'k', version: '1',
      body: [{ id: 'img-1', type: 'image', source: 'tenantLogo', height: 24 }],
    };
    render(
      <DesignerInspector doc={imageDoc} lang="en" selectedId="img-1" editing={makeEditing({ isOverlayInsert: () => true })} />,
    );
    // The insert path is a Select, not a free-text input.
    expect(screen.getByTestId('image-source-select')).toBeInTheDocument();
    expect(screen.queryByTestId('locked-control')).not.toBeInTheDocument();
  });
});

describe('DesignerInspector (add column / add field gestures)', () => {
  const editDoc: ReportDefinitionDoc = {
    schemaVersion: 1, key: 'k', version: '1',
    body: [
      {
        id: 'tbl-1', type: 'table', bind: 'workOrders',
        columns: [
          { id: 'col-1', header: { en: 'A' }, path: 'a' },
          { id: 'col-2', header: { en: 'B' }, path: 'b' },
        ],
      },
      { id: 'kvg-1', type: 'keyValueGrid', pairs: [{ id: 'kvp-1', label: { en: 'One' }, path: 'one' }] },
    ],
  };

  it('adds a column skeleton anchored after the last column and selects it', async () => {
    const user = userEvent.setup();
    const insert = vi.fn<(el: Record<string, unknown>, target: InsertTarget) => string>((el) => String(el.id));
    const onSelect = vi.fn();
    render(
      <DesignerInspector doc={editDoc} lang="en" selectedId="tbl-1" editing={makeEditing({ insert })} onSelect={onSelect} />,
    );

    await user.click(screen.getByTestId('add-column-button'));
    expect(insert).toHaveBeenCalledTimes(1);
    const [element, target] = insert.mock.calls[0]!;
    expect(element).toMatchObject({ header: { en: 'Column' }, path: '' });
    expect(typeof element.id).toBe('string');
    expect(target).toEqual({ anchor: 'col-2', position: 'after', section: 'body' });
    expect(onSelect).toHaveBeenCalledWith(element.id);
  });

  it('adds a field skeleton anchored after the last pair and selects it', async () => {
    const user = userEvent.setup();
    const insert = vi.fn<(el: Record<string, unknown>, target: InsertTarget) => string>((el) => String(el.id));
    const onSelect = vi.fn();
    render(
      <DesignerInspector doc={editDoc} lang="en" selectedId="kvg-1" editing={makeEditing({ insert })} onSelect={onSelect} />,
    );

    await user.click(screen.getByTestId('add-field-button'));
    expect(insert).toHaveBeenCalledTimes(1);
    const [element, target] = insert.mock.calls[0]!;
    expect(element).toMatchObject({ label: { en: 'Label' }, path: '' });
    expect(typeof element.id).toBe('string');
    expect(target).toEqual({ anchor: 'kvp-1', position: 'after', section: 'body' });
    expect(onSelect).toHaveBeenCalledWith(element.id);
  });
});

// ─── Standard-mode authoring (#2164 slice C) ────────────────────────────────

function makeSettings(over: Partial<DesignerSettingsEditing> = {}): DesignerSettingsEditing {
  return {
    setTitle: vi.fn(),
    setDataSource: vi.fn(),
    setKey: vi.fn(),
    setVersion: vi.fn(),
    setRequiredPermission: vi.fn(),
    setPage: vi.fn(),
    setBaseFontSize: vi.fn(),
    setParameters: vi.fn(),
    ...over,
  } as DesignerSettingsEditing;
}

/** Standard mode: structure fully unlocked (`canEditStructure` always true) + settings. */
function makeStandardEditing(over: Partial<DesignerEditing> = {}): DesignerEditing {
  return makeEditing({
    mode: 'definition',
    canEditStructure: () => true,
    settings: makeSettings(),
    ...over,
  });
}

const stdDoc: ReportDefinitionDoc = {
  schemaVersion: 1,
  key: 'std-report',
  version: '3.0.0',
  title: { en: 'Report' },
  dataSource: 'assets',
  page: { size: 'A4', orientation: 'portrait', margin: 24 },
  parameters: [{ name: 'assetId', type: 'guid', required: true }],
  body: [
    {
      id: 'tbl-1',
      type: 'table',
      bind: 'workOrders',
      columns: [{ id: 'col-1', header: { en: 'Cost' }, path: 'cost' }],
    },
  ],
};

describe('DesignerInspector (standard authoring mode)', () => {
  it('unlocks a table bind in standard mode and edits it directly', async () => {
    const user = userEvent.setup();
    const setProp = vi.fn();
    render(
      <DesignerInspector doc={stdDoc} lang="en" selectedId="tbl-1" editing={makeStandardEditing({ setProp })} />,
    );

    const bind = screen.getByDisplayValue('workOrders');
    // Standard structure is not owned by a standard — no lock wrapper.
    expect(bind.closest('[data-testid="locked-control"]')).toBeNull();
    await user.type(bind, 'X');
    expect(setProp).toHaveBeenCalledWith('tbl-1', 'bind', 'workOrdersX', undefined);
  });

  it('keeps a standard table bind locked in tenant mode (regression guard)', () => {
    // canEditStructure gates a standard element false → the bind stays locked.
    render(
      <DesignerInspector doc={stdDoc} lang="en" selectedId="tbl-1" editing={makeEditing({ canEditStructure: () => false })} />,
    );

    const bind = screen.getByDisplayValue('workOrders');
    expect(bind.closest('[data-testid="locked-control"]')).not.toBeNull();
  });

  it('adds a table total in standard mode and commits the totals array', async () => {
    const user = userEvent.setup();
    const setProp = vi.fn();
    render(
      <DesignerInspector doc={stdDoc} lang="en" selectedId="tbl-1" editing={makeStandardEditing({ setProp })} />,
    );

    await user.click(screen.getByRole('button', { name: /grouping/i }));
    await user.click(screen.getByTestId('add-total-button'));
    expect(setProp).toHaveBeenCalledWith('tbl-1', 'totals', [{ columnId: 'col-1', aggregate: 'sum' }], undefined);
  });

  it('edits the report title through LangText and calls settings.setTitle', async () => {
    const user = userEvent.setup();
    const setTitle = vi.fn();
    render(
      <DesignerInspector
        doc={stdDoc}
        lang="en"
        selectedId={REPORT_SETTINGS_ID}
        editing={makeStandardEditing({ settings: makeSettings({ setTitle }) })}
      />,
    );

    const title = screen.getByLabelText('Content in EN');
    await user.type(title, 'X');
    expect(setTitle).toHaveBeenCalledWith({ en: 'ReportX' });
  });

  it('adds a parameter and calls settings.setParameters with the appended row', async () => {
    const user = userEvent.setup();
    const setParameters = vi.fn();
    render(
      <DesignerInspector
        doc={stdDoc}
        lang="en"
        selectedId={REPORT_SETTINGS_ID}
        editing={makeStandardEditing({ settings: makeSettings({ setParameters }) })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /parameters/i }));
    await user.click(screen.getByTestId('add-parameter-button'));
    expect(setParameters).toHaveBeenCalledWith([
      { name: 'assetId', type: 'guid', required: true },
      { name: 'newParam', type: 'string', required: false },
    ]);
  });

  it('edits the version and calls settings.setVersion', async () => {
    const user = userEvent.setup();
    const setVersion = vi.fn();
    render(
      <DesignerInspector
        doc={stdDoc}
        lang="en"
        selectedId={REPORT_SETTINGS_ID}
        editing={makeStandardEditing({ settings: makeSettings({ setVersion }) })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /identity/i }));
    const version = screen.getByDisplayValue('3.0.0');
    await user.type(version, 'X');
    expect(setVersion).toHaveBeenCalledWith('3.0.0X');
  });

  it('renders editable Report settings (no lock) when settings are provided', () => {
    render(
      <DesignerInspector doc={stdDoc} lang="en" selectedId={REPORT_SETTINGS_ID} editing={makeStandardEditing()} />,
    );
    // Standard mode: the settings body is editable, not the locked read-only display.
    expect(screen.queryByTestId('locked-control')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('std-report')).toBeInTheDocument();
  });
});
