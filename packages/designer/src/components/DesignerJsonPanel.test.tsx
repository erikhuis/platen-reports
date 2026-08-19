import React from 'react';
import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it , vi} from 'vitest';
import DesignerJsonPanel from './DesignerJsonPanel';
import { REPORT_SETTINGS_ID } from '@platen-reports/model';
import { DesignerIntlTestProvider } from '../test/harness';

// The provider's translator is the global jest moduleNameMapper mock (real en.json).
const render = (ui: React.ReactElement) =>
  rtlRender(ui, { wrapper: DesignerIntlTestProvider });

const standardJson = JSON.stringify(
  {
    key: 'asset-print',
    version: '1.0.0',
    body: [
      { id: 'txt-1', type: 'text', text: 'Title' },
      { id: 'fld-1', type: 'field', path: 'asset.standardPath' },
    ],
  },
  null,
  2,
);

const effectiveJson = JSON.stringify(
  {
    key: 'asset-print',
    version: '1.0.0',
    body: [
      { id: 'txt-1', type: 'text', text: 'Title' },
      { id: 'fld-1', type: 'field', path: 'asset.effectivePath' },
    ],
  },
  null,
  2,
);

const mockWriteText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);

beforeEach(() => {
  mockWriteText.mockClear();
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: mockWriteText },
    configurable: true,
  });
});

function renderPanel(selectedId: string = REPORT_SETTINGS_ID) {
  return render(
    <DesignerJsonPanel standardJson={standardJson} effectiveJson={effectiveJson} selectedId={selectedId} />,
  );
}

const content = () => screen.getByTestId('designer-json-content');

describe('DesignerJsonPanel', () => {
  it('shows the effective document by default and swaps content on tab switch', () => {
    renderPanel();

    expect(content().textContent).toContain('asset.effectivePath');
    expect(content().textContent).not.toContain('asset.standardPath');

    fireEvent.click(screen.getByRole('tab', { name: 'Standard' }));
    expect(content().textContent).toContain('asset.standardPath');
    expect(content().textContent).not.toContain('asset.effectivePath');

    fireEvent.click(screen.getByRole('tab', { name: 'Effective' }));
    expect(content().textContent).toContain('asset.effectivePath');
  });

  it('highlights exactly the JSON object containing the selected id', () => {
    renderPanel('fld-1');

    const highlight = screen.getByTestId('designer-json-highlight');
    expect(highlight.textContent).toContain('"id": "fld-1"');
    expect(highlight.textContent).toContain('asset.effectivePath');
    // The sibling element's object is outside the highlighted range.
    expect(highlight.textContent).not.toContain('txt-1');
    expect(highlight.textContent!.startsWith('{')).toBe(true);
    expect(highlight.textContent!.endsWith('}')).toBe(true);
  });

  it('re-anchors the highlight to the active tab document', () => {
    renderPanel('fld-1');
    fireEvent.click(screen.getByRole('tab', { name: 'Standard' }));

    expect(screen.getByTestId('designer-json-highlight').textContent).toContain('asset.standardPath');
  });

  it('renders no highlight for the report-settings pseudo id', () => {
    renderPanel(REPORT_SETTINGS_ID);
    expect(screen.queryByTestId('designer-json-highlight')).not.toBeInTheDocument();
  });

  it('syntax-colors property keys, string values, and literals as distinct spans', () => {
    renderPanel();

    const keySpans = Array.from(content().querySelectorAll('[data-json-token="key"]'));
    expect(keySpans.map((span) => span.textContent)).toContain('"key"');
    expect(keySpans[0]).toHaveStyle({ color: '#0369A1' });

    const stringSpans = Array.from(content().querySelectorAll('[data-json-token="string"]'));
    expect(stringSpans.map((span) => span.textContent)).toContain('"asset-print"');
    expect(stringSpans[0]).toHaveStyle({ color: '#15803D' });

    // Keys and string values are told apart by the trailing colon.
    expect(keySpans.map((span) => span.textContent)).not.toContain('"asset-print"');
  });

  it('keeps syntax coloring inside the selection highlight', () => {
    renderPanel('fld-1');

    const highlight = screen.getByTestId('designer-json-highlight');
    const highlightKeys = Array.from(highlight.querySelectorAll('[data-json-token="key"]'));
    expect(highlightKeys.map((span) => span.textContent)).toContain('"path"');
  });

  it('copies the active document to the clipboard', async () => {
    renderPanel();

    fireEvent.click(screen.getByTestId('designer-json-copy'));
    expect(mockWriteText).toHaveBeenCalledWith(effectiveJson);
    await act(async () => {}); // flush the async success state inside act

    fireEvent.click(screen.getByRole('tab', { name: 'Standard' }));
    fireEvent.click(screen.getByTestId('designer-json-copy'));
    expect(mockWriteText).toHaveBeenLastCalledWith(standardJson);
    await act(async () => {});
  });

  it('shows the success check only after the clipboard write resolves', async () => {
    renderPanel();
    const copyButton = screen.getByTestId('designer-json-copy');

    fireEvent.click(copyButton);
    // Still pending — no premature success state.
    expect(copyButton.querySelector('.lucide-check')).toBeNull();

    await act(async () => {});
    expect(copyButton.querySelector('.lucide-check')).not.toBeNull();
  });

  it('never shows the success check when the clipboard write rejects', async () => {
    mockWriteText.mockRejectedValueOnce(new Error('denied'));
    renderPanel();
    const copyButton = screen.getByTestId('designer-json-copy');

    fireEvent.click(copyButton);
    await act(async () => {});

    expect(mockWriteText).toHaveBeenCalledWith(effectiveJson);
    expect(copyButton.querySelector('.lucide-check')).toBeNull();
  });

  it('does nothing (and does not crash) when the clipboard API is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    renderPanel();
    const copyButton = screen.getByTestId('designer-json-copy');

    fireEvent.click(copyButton);
    await act(async () => {});

    expect(copyButton.querySelector('.lucide-check')).toBeNull();
  });
});
