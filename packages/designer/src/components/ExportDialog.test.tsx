import React from 'react';
import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExportDialog from './ExportDialog';
import { DesignerIntlTestProvider } from '../test/harness';

const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: DesignerIntlTestProvider });

const mockWriteText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);

beforeEach(() => {
  mockWriteText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: mockWriteText }, configurable: true });
});

function renderDialog() {
  return render(<ExportDialog open onClose={vi.fn()} fileName="wo.json" json="{}" problemCount={0} />);
}

describe('ExportDialog', () => {
  it('shows the success check once the copy resolves', async () => {
    renderDialog();

    fireEvent.click(screen.getByTestId('designer-export-copy'));
    await act(async () => {});

    expect(mockWriteText).toHaveBeenCalledWith('{}');
    expect(screen.getByTestId('designer-export-copy').querySelector('.lucide-check')).not.toBeNull();
  });

  // Regression: the copy-feedback reset timer had no unmount cleanup, unlike the identical
  // pattern in DesignerJsonPanel.tsx — a pending setCopied(false) fired against an unmounted
  // component whenever the dialog (or its host, e.g. an authoring-mode toggle in DesignerShell)
  // unmounted within the 2s window.
  it('clears the pending copy-feedback timer on unmount', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const { unmount } = renderDialog();

    fireEvent.click(screen.getByTestId('designer-export-copy'));
    await act(async () => {});

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it('export is disabled and download/copy are blocked while client validation reports problems', () => {
    render(<ExportDialog open onClose={vi.fn()} fileName="wo.json" json="{}" problemCount={2} />);

    expect(screen.getByTestId('designer-export-blocked')).toBeInTheDocument();
    expect(screen.getByTestId('designer-export-copy')).toBeDisabled();
    expect(screen.getByTestId('designer-export-download')).toBeDisabled();
  });
});
