import React from 'react';
import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it , vi} from 'vitest';
import type { Mock } from 'vitest';
import type { ReportDefinitionDoc } from '@platen-reports/model';
import { DesignerTestProvider } from '../test/harness';
import AddBlockDialog from './AddBlockDialog';
import type { DesignerEditing, InsertTarget } from '@platen-reports/model';

// ─── Harness ──────────────────────────────────────────────────────────────────

const render = (ui: React.ReactElement) =>
  rtlRender(ui, { wrapper: DesignerTestProvider });


// ─── Fixture: a body that already carries a txt-1, so a fresh text id must bump ─

const doc: ReportDefinitionDoc = {
  schemaVersion: 1,
  key: 'asset-print',
  version: '1.0.0',
  body: [
    { id: 'txt-1', type: 'text', text: { en: 'Existing' } },
    { id: 'box-1', type: 'container', title: { en: 'Card' }, children: [] },
  ],
};

const bodyTarget: InsertTarget = { anchor: '$body', position: 'appendInto', section: 'body' };
const headerTarget: InsertTarget = { anchor: 'hdr', position: 'appendInto', section: 'header' };

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
    // Echo the skeleton's own id as the "returned id" (for selection).
    insert: vi.fn((element: Record<string, unknown>) => element.id as string),
    insertTargetFor: vi.fn(() => bodyTarget),
    ...overrides,
  };
}

describe('AddBlockDialog', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows the tenant-insert note', () => {
    render(
      <AddBlockDialog
        open onClose={vi.fn()} target={bodyTarget} editing={makeEditing()} doc={doc}
      />,
    );
    expect(screen.getByText('designerAddBlockNote')).toBeInTheDocument();
  });

  it('disables pageNumber for a body target with the header/footer-only tooltip', () => {
    render(
      <AddBlockDialog
        open onClose={vi.fn()} target={bodyTarget} editing={makeEditing()} doc={doc}
      />,
    );
    expect(screen.getByRole('button', { name: 'elementType.pageNumber' })).toBeDisabled();
    // The reused note text is present as the (disabled-button) tooltip label.
    expect(screen.getAllByLabelText('designerPageNumberNote').length).toBeGreaterThan(0);
  });

  it('enables pageNumber for a header/footer target', () => {
    render(
      <AddBlockDialog
        open onClose={vi.fn()} target={headerTarget} editing={makeEditing()} doc={doc}
      />,
    );
    expect(screen.getByRole('button', { name: 'elementType.pageNumber' })).toBeEnabled();
  });

  it('inserts a typed text skeleton with a fresh id and selects it', () => {
    const editing = makeEditing();
    const onAdded = vi.fn();
    const onClose = vi.fn();
    render(
      <AddBlockDialog
        open onClose={onClose} target={bodyTarget} editing={editing} doc={doc} onAdded={onAdded}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'elementType.text' }));

    expect(editing.insert).toHaveBeenCalledTimes(1);
    const [skeleton, target] = (editing.insert as Mock).mock.calls[0]!;
    // Fresh id skips the existing txt-1.
    expect(skeleton).toEqual({ id: 'txt-2', type: 'text', text: { en: 'New text' } });
    expect(target).toEqual(bodyTarget);
    // The returned id is selected, then the dialog closes.
    expect(onAdded).toHaveBeenCalledWith('txt-2');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('builds a keyValueGrid skeleton whose nested pair id never self-collides', () => {
    const editing = makeEditing();
    render(
      <AddBlockDialog
        open onClose={vi.fn()} target={bodyTarget} editing={editing} doc={doc}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'elementType.keyValueGrid' }));

    const [skeleton] = (editing.insert as Mock).mock.calls[0]!;
    expect(skeleton).toEqual({
      id: 'kvg-1',
      type: 'keyValueGrid',
      pairs: [{ id: 'kvp-1', label: { en: 'Label' }, path: '' }],
    });
  });
});
