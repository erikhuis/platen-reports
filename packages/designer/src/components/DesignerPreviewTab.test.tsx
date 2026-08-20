import React from 'react';
import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it , vi} from 'vitest';
import type { ReportCatalogueItem, ReportPreviewBlob, ReportPreviewRequest } from '@platen-reports/model';
import type { DesignerTranslate } from '../designerContext';
import { DesignerTestProvider, stubReportsApi } from '../test/harness';
import DesignerPreviewTab from './DesignerPreviewTab';

// Mirror the component's debounce window so the tests read like the timeline they exercise.
const PREVIEW_DEBOUNCE_MS = 900;

// ─── Injected API client (#2445 — no module mock; the port comes from the provider) ──

const mockPreviewPdf = vi.fn<(request: ReportPreviewRequest) => Promise<ReportPreviewBlob>>();
const api = stubReportsApi({ previewPdf: (request) => mockPreviewPdf(request) });

// The translator must be referentially stable across renders (as a real i18n library's
// memoized translator is) — a fresh function per render can re-run effects endlessly.
const translate: DesignerTranslate = (key) => key;
const DesignerHost = ({ children }: { children: React.ReactNode }) => (
  <DesignerTestProvider t={translate} api={api}>{children}</DesignerTestProvider>
);
const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: DesignerHost });

// jsdom implements neither side of the blob-URL lifecycle. Since #2445 the client returns a
// Blob and THIS component owns create + revoke, so both sides are stubbed: `blobFor` mints a
// blob tagged with the URL it should mint, which keeps the assertions readable.
const mockCreateObjectURL = vi.fn<(blob: Blob) => string>();
const mockRevokeObjectURL = vi.fn<(url: string) => void>();
Object.assign(URL, {
  createObjectURL: mockCreateObjectURL,
  revokeObjectURL: mockRevokeObjectURL,
});

const urlByBlob = new Map<Blob, string>();
function blobFor(url: string): Blob {
  const blob = new Blob([url]);
  urlByBlob.set(blob, url);
  return blob;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const report: ReportCatalogueItem = {
  key: 'asset-print',
  title: 'Asset card',
  version: '1.0.0',
  dataSource: 'asset-print',
  requiredPermission: null,
  hasOverlay: false,
  overlayEnabled: false,
  parameters: [{ name: 'assetId', type: 'guid', required: true }],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

const paramField = () => screen.getByRole('textbox', { name: /assetId/ }) as HTMLInputElement;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DesignerPreviewTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    urlByBlob.clear();
    mockCreateObjectURL.mockImplementation((blob) => urlByBlob.get(blob) ?? 'blob:untagged');
    mockPreviewPdf.mockResolvedValue(blobFor('blob:default'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not fetch until required parameters are filled, and resets the spinner on early return', async () => {
    render(<DesignerPreviewTab reportKey="asset-print" report={report} lang="en" />);

    // Required parameter empty → hint shown, never a fetch.
    expect(screen.getByTestId('designer-preview-hint')).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS * 3); });
    expect(mockPreviewPdf).not.toHaveBeenCalled();

    // Filling the parameter arms the debounce and shows the spinner…
    fireEvent.change(paramField(), { target: { value: 'a-1' } });
    expect(screen.queryByTestId('designer-preview-hint')).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();

    // …clearing it before the debounce fires must clear the spinner too (#2150) and
    // cancel the pending fetch.
    fireEvent.change(paramField(), { target: { value: '' } });
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS); });
    expect(mockPreviewPdf).not.toHaveBeenCalled();
  });

  it('debounces to a single previewPdf call with the filled parameters and the seg language', async () => {
    // lang="nl" while the (mocked) UI locale is 'en' — the server PDF must follow the
    // header language seg (the LocalizedText display language), not the UI locale.
    render(<DesignerPreviewTab reportKey="asset-print" report={report} lang="nl" />);

    fireEvent.change(paramField(), { target: { value: 'a-1' } });
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS / 2); });
    // Typing again inside the debounce window supersedes the pending timer.
    fireEvent.change(paramField(), { target: { value: 'a-12' } });
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS); });

    expect(mockPreviewPdf).toHaveBeenCalledTimes(1);
    expect(mockPreviewPdf).toHaveBeenCalledWith({
      key: 'asset-print',
      overlayJson: null,
      definitionJson: undefined,
      parameters: { assetId: 'a-12' },
      locale: 'nl',
    });

    await act(async () => {}); // flush the resolved blob
    expect(screen.getByTestId('designer-preview-frame')).toHaveAttribute('src', 'blob:default');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('never mints an object URL for a stale response (request-id guard, no blob leak)', async () => {
    const firstPdf = deferred<Blob>();
    const secondPdf = deferred<Blob>();
    mockPreviewPdf
      .mockReturnValueOnce(firstPdf.promise)
      .mockReturnValueOnce(secondPdf.promise);

    render(<DesignerPreviewTab reportKey="asset-print" report={report} lang="en" />);

    fireEvent.change(paramField(), { target: { value: 'a-1' } });
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS); });
    expect(mockPreviewPdf).toHaveBeenCalledTimes(1); // preview #1 in flight

    fireEvent.change(paramField(), { target: { value: 'a-2' } });
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS); });
    expect(mockPreviewPdf).toHaveBeenCalledTimes(2); // preview #2 in flight

    // The newer preview lands first…
    await act(async () => { secondPdf.resolve(blobFor('blob:new')); });
    expect(screen.getByTestId('designer-preview-frame')).toHaveAttribute('src', 'blob:new');

    // …then the stale one arrives. Since the component owns creation it simply never mints a
    // URL for it — the pre-#2445 client created one eagerly and relied on the caller to revoke.
    await act(async () => { firstPdf.resolve(blobFor('blob:stale')); });
    expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
    expect(mockRevokeObjectURL).not.toHaveBeenCalledWith('blob:stale');
    expect(screen.getByTestId('designer-preview-frame')).toHaveAttribute('src', 'blob:new');
  });

  it('revokes the displayed object URL when a newer preview replaces it', async () => {
    render(<DesignerPreviewTab reportKey="asset-print" report={report} lang="en" />);

    fireEvent.change(paramField(), { target: { value: 'a-1' } });
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS); });
    await act(async () => {});
    expect(screen.getByTestId('designer-preview-frame')).toHaveAttribute('src', 'blob:default');
    expect(mockRevokeObjectURL).not.toHaveBeenCalled();

    mockPreviewPdf.mockResolvedValue(blobFor('blob:second'));
    fireEvent.change(paramField(), { target: { value: 'a-2' } });
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS); });
    await act(async () => {});

    expect(screen.getByTestId('designer-preview-frame')).toHaveAttribute('src', 'blob:second');
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:default');
  });

  it('reports a client that resolves something other than a Blob, and mints no URL', async () => {
    // #10 widened the port to a Blob-*shaped* payload so the published declarations stop
    // needing a DOM lib. createObjectURL still takes no substitute, so the component narrows
    // with `instanceof` and turns a duck-typed payload into a preview error the host can act
    // on — rather than letting jsdom or a browser throw an opaque overload failure.
    const notABlob: ReportPreviewBlob = {
      size: 8,
      type: 'application/pdf',
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    };
    mockPreviewPdf.mockResolvedValue(notABlob);

    render(<DesignerPreviewTab reportKey="asset-print" report={report} lang="en" />);
    fireEvent.change(paramField(), { target: { value: 'a-1' } });
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS); });
    await act(async () => {});

    expect(screen.getByText(/must resolve to a Blob/)).toBeInTheDocument();
    expect(mockCreateObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByTestId('designer-preview-frame')).not.toBeInTheDocument();
  });

  it('revokes the displayed object URL on unmount', async () => {
    const view = render(<DesignerPreviewTab reportKey="asset-print" report={report} lang="en" />);

    fireEvent.change(paramField(), { target: { value: 'a-1' } });
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS); });
    await act(async () => {});
    expect(mockRevokeObjectURL).not.toHaveBeenCalled();

    view.unmount();
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:default');
  });

  it('resets parameters and drops the old PDF when the report key changes without a remount', async () => {
    const view = render(<DesignerPreviewTab reportKey="asset-print" report={report} lang="en" />);

    fireEvent.change(paramField(), { target: { value: 'a-1' } });
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS); });
    await act(async () => {}); // flush 'blob:default'
    expect(screen.getByTestId('designer-preview-frame')).toHaveAttribute('src', 'blob:default');

    const otherReport: ReportCatalogueItem = {
      ...report,
      key: 'wo-print',
      parameters: [{ name: 'assetId', type: 'guid', required: true }],
    };
    view.rerender(<DesignerPreviewTab reportKey="wo-print" report={otherReport} lang="en" />);
    await act(async () => {});

    // Parameter emptied, previous blob revoked, no frame for the new report yet.
    expect(paramField().value).toBe('');
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:default');
    expect(screen.queryByTestId('designer-preview-frame')).not.toBeInTheDocument();
    expect(screen.getByTestId('designer-preview-hint')).toBeInTheDocument();
  });
});
