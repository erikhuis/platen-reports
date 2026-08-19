import React from 'react';
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it , vi} from 'vitest';
import type { ReportCatalogueItem } from '@platen-reports/model';
import type { ReportDefinitionDoc } from '@platen-reports/model';
import type { DesignerConfirmOptions, ReportDesignerContextValue } from '../designerContext';
import { DesignerTestProvider, stubReportsApi } from '../test/harness';
import DesignerShell, { type DesignerLoadedData } from './DesignerShell';

// ─── Injected API client (#2445 — the port arrives through the provider) ──────

const mockDeleteOverlay = vi.fn<(key: string) => Promise<void>>();
const api = stubReportsApi({ deleteOverlay: (key) => mockDeleteOverlay(key) });

// ─── Fixture ──────────────────────────────────────────────────────────────────

const standardDoc: ReportDefinitionDoc = {
  schemaVersion: 1,
  key: 'asset-print',
  version: '1.0.0',
  title: { en: 'Asset card' },
  dataSource: 'assets',
  body: [
    { id: 'txt-1', type: 'text', text: { en: 'Hello' } },
    { id: 'fld-1', type: 'field', path: 'asset.code' },
  ],
};

const catalogueItem: ReportCatalogueItem = {
  key: 'asset-print',
  title: 'Asset card',
  version: '1.0.0',
  dataSource: 'assets',
  requiredPermission: 'Assets.View',
  hasOverlay: true,
  overlayEnabled: true,
  parameters: [],
};

const data: DesignerLoadedData = {
  catalogue: [catalogueItem, { ...catalogueItem, key: 'wo-print', title: 'Work order' }],
  standardDoc,
  standardJson: JSON.stringify(standardDoc, null, 2),
  effectiveDoc: standardDoc,
  effectiveJson: JSON.stringify(standardDoc, null, 2),
  initialOverlay: { schemaVersion: 1, reportKey: 'asset-print' },
  initialEnabled: true,
};

function renderShell(host: Partial<ReportDesignerContextValue> = {}) {
  return rtlRender(
    <DesignerTestProvider api={api} {...host}>
      <DesignerShell reportKey="asset-print" data={data} onSaved={vi.fn()} />
    </DesignerTestProvider>,
  );
}

const inspectorInputs = () =>
  document.querySelectorAll('[data-testid="designer-inspector"] input, [data-testid="designer-inspector"] textarea');

describe('DesignerShell host contract', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('locks every control when the host reports canEdit: false', () => {
    renderShell({ canEdit: false });

    // No way into either editing surface…
    expect(screen.queryByTestId('designer-authoring-seg')).not.toBeInTheDocument();
    expect(screen.queryByTestId('designer-save')).not.toBeInTheDocument();
    expect(screen.queryByTestId('designer-revert')).not.toBeInTheDocument();
    expect(screen.queryByTestId('designer-export')).not.toBeInTheDocument();
    // …no mode badges or banners…
    expect(screen.queryByTestId('designer-tenant-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('designer-tenant-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('designer-standard-badge')).not.toBeInTheDocument();
    // …and the inspector stays read-only for every selection, not just the initial one:
    // report settings render as bare rows (no lock chrome — there is nothing to lock),
    // and selecting a text element still yields no input and no reset affordance.
    expect(screen.getByTestId('designer-inspector')).toBeInTheDocument();
    expect(inspectorInputs()).toHaveLength(0);
    expect(screen.queryAllByTestId('locked-control')).toHaveLength(0);

    fireEvent.click(screen.getByTestId('designer-outline-row-txt-1'));
    expect(inspectorInputs()).toHaveLength(0);
    expect(screen.queryAllByTestId('reset-prop')).toHaveLength(0);
  });

  it('opens the editing surface when the host reports canEdit: true', () => {
    renderShell({ canEdit: true });

    expect(screen.getByTestId('designer-authoring-seg')).toBeInTheDocument();
    expect(screen.getByTestId('designer-tenant-badge')).toBeInTheDocument();
    expect(screen.getByTestId('designer-tenant-banner')).toBeInTheDocument();
    expect(screen.getByTestId('designer-save')).toBeInTheDocument();
    expect(screen.getByTestId('designer-revert')).toBeInTheDocument();
    // Tenant mode locks the standard-owned report settings — lock chrome the read-only
    // surface never renders — and a selected element becomes editable.
    expect(screen.getAllByTestId('locked-control').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId('designer-outline-row-txt-1'));
    expect(inspectorInputs().length).toBeGreaterThan(0);
  });

  it('routes the back affordance through onBack, and hides it when the host omits one', () => {
    const onBack = vi.fn();
    const view = renderShell({ onBack });
    fireEvent.click(screen.getByTestId('designer-back'));
    expect(onBack).toHaveBeenCalledTimes(1);

    view.unmount();
    renderShell({ onBack: undefined });
    expect(screen.queryByTestId('designer-back')).not.toBeInTheDocument();
  });

  it('disables the report switcher when the host cannot navigate between reports', () => {
    renderShell({ onSelectReport: undefined });
    expect(screen.getByTestId('designer-report-switcher')).toHaveClass('Mui-disabled');
  });

  it('gates revert behind the built-in confirm — cancelling deletes nothing', async () => {
    renderShell({ canEdit: true });

    fireEvent.click(screen.getByTestId('designer-revert'));
    const cancel = await screen.findByText('designerConfirmCancel');
    fireEvent.click(cancel);

    await waitFor(() => expect(screen.queryByText('designerConfirmCancel')).not.toBeInTheDocument());
    expect(mockDeleteOverlay).not.toHaveBeenCalled();
  });

  it('keeps the confirm wording readable while the dialog fades out', async () => {
    renderShell({ canEdit: true });

    fireEvent.click(screen.getByTestId('designer-revert'));
    expect(await screen.findByText('designerRevertConfirm')).toBeInTheDocument();

    fireEvent.click(screen.getByText('designerConfirmCancel'));

    // MUI keeps the dialog mounted for its exit transition. Clearing the options on settle
    // would blank the title, body and confirm label for the whole fade-out.
    expect(screen.getByText('designerRevertConfirm')).toBeInTheDocument();
    expect(screen.getByTestId('designer-confirm-accept')).toHaveTextContent('revertToStandard');

    await waitFor(() => expect(screen.queryByText('designerRevertConfirm')).not.toBeInTheDocument());
  });

  it('reverts once the built-in confirm is accepted', async () => {
    mockDeleteOverlay.mockResolvedValue(undefined);
    renderShell({ canEdit: true });

    fireEvent.click(screen.getByTestId('designer-revert'));
    fireEvent.click(await screen.findByTestId('designer-confirm-accept'));

    await waitFor(() => expect(mockDeleteOverlay).toHaveBeenCalledWith('asset-print'));
  });

  // Regression: handleRevert read overlayState.saveError from the render that created its
  // useCallback closure — stale, since useOverlayEditing's setSaveError call lands in a LATER
  // render. The toast used to show the generic fallback (or a PREVIOUS attempt's error) instead
  // of the error the just-awaited revert() call actually produced.
  it('shows the actual revert error, not the generic fallback, when the revert fails', async () => {
    mockDeleteOverlay.mockRejectedValueOnce(new Error('locked by another editor'));
    renderShell({ canEdit: true });

    fireEvent.click(screen.getByTestId('designer-revert'));
    fireEvent.click(await screen.findByTestId('designer-confirm-accept'));

    expect(await screen.findByText('Error: locked by another editor')).toBeInTheDocument();
    expect(screen.queryByText('designerSaveFailed')).not.toBeInTheDocument();
  });

  it('shows each failed revert\'s own error, never a previous attempt\'s', async () => {
    mockDeleteOverlay.mockRejectedValueOnce(new Error('first failure'));
    renderShell({ canEdit: true });

    fireEvent.click(screen.getByTestId('designer-revert'));
    fireEvent.click(await screen.findByTestId('designer-confirm-accept'));
    expect(await screen.findByText('Error: first failure')).toBeInTheDocument();

    mockDeleteOverlay.mockRejectedValueOnce(new Error('second failure'));
    fireEvent.click(screen.getByTestId('designer-revert'));
    fireEvent.click(await screen.findByTestId('designer-confirm-accept'));

    expect(await screen.findByText('Error: second failure')).toBeInTheDocument();
    expect(screen.queryByText('Error: first failure')).not.toBeInTheDocument();
  });

  it('uses a host-supplied confirm instead of the built-in dialog', async () => {
    const confirm = vi.fn<(o: DesignerConfirmOptions) => Promise<boolean>>().mockResolvedValue(false);
    renderShell({ canEdit: true, confirm });

    fireEvent.click(screen.getByTestId('designer-revert'));

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0]![0]).toMatchObject({ title: 'revertToStandard', body: 'designerRevertConfirm' });
    // The built-in dialog must not render at all once the host owns confirmation.
    expect(screen.queryByTestId('designer-confirm')).not.toBeInTheDocument();
    expect(mockDeleteOverlay).not.toHaveBeenCalled();
  });
});
