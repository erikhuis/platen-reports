import { describe, expect, it, beforeEach , vi} from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReportDefinitionDoc } from '@platen-reports/model';
import type { ReportOverlayDoc } from '@platen-reports/model';
import type { ReportsApiClient } from '@platen-reports/model';
import { stubReportsApi } from './test/harness';
import { useOverlayEditing } from './useOverlayEditing';

// #2445 — the hook takes the reporting API port as an argument, so these are a fake client's
// methods rather than a module replacement. Each mock is typed
// against the port, so a signature change there breaks this file at compile time.
const mockValidate = vi.fn<ReportsApiClient['validateOverlay']>();
const mockPut = vi.fn<ReportsApiClient['putOverlay']>();
const mockDelete = vi.fn<ReportsApiClient['deleteOverlay']>();
const mockGet = vi.fn<ReportsApiClient['getOverlay']>();
const api = stubReportsApi({
  validateOverlay: mockValidate,
  putOverlay: mockPut,
  deleteOverlay: mockDelete,
  getOverlay: mockGet,
});

const standard: ReportDefinitionDoc = {
  schemaVersion: 1, key: 'r', version: '2.0.0', title: 'R',
  body: [
    { id: 'detail-text', type: 'text', text: 'Detail' },
    { id: 'lines', type: 'table', bind: 'item.lines', columns: [{ id: 'col-a', header: 'A', path: 'a' }] },
  ],
};

const render = (overlay: ReportOverlayDoc = { schemaVersion: 1, reportKey: 'r' }, enabled = true) =>
  renderHook(() => useOverlayEditing({
    api, reportKey: 'r', standard, initialOverlay: overlay, initialEnabled: enabled,
    onError: (e) => String(e),
  }));

describe('useOverlayEditing', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('compiles a prop edit into setProps and marks the overlay dirty', () => {
    const { result } = render();
    expect(result.current.dirty).toBe(false);
    act(() => result.current.editing.setProp('detail-text', 'style.fontSize', 14, 9));
    expect(result.current.dirty).toBe(true);
    expect(JSON.parse(result.current.overlayJson).setProps).toEqual([
      { id: 'detail-text', props: { 'style.fontSize': 14 } },
    ]);
    expect(result.current.editing.touchedProps('detail-text').has('style.fontSize')).toBe(true);
  });

  it('surfaces merge warnings and inserted-element problems', () => {
    const { result } = render({ schemaVersion: 1, reportKey: 'r', baseVersion: '1.0.0' });
    expect(result.current.baseVersionOutdated).toBe(true);
    act(() => result.current.editing.insert({ id: 'fld-1', type: 'field', path: '' }, { anchor: '$body', position: 'appendInto', section: 'body' }));
    // A field with no path is a fatal problem on the inserted element.
    expect(result.current.problems.some((p) => p.id === 'fld-1' && p.code === 'fieldMissingPath')).toBe(true);
  });

  it('save validates then PUTs then re-fetches to sync baseVersion', async () => {
    mockValidate.mockResolvedValue({ valid: true, errors: [], warnings: [] });
    mockPut.mockResolvedValue({ valid: true, errors: [], warnings: [] });
    mockGet.mockResolvedValue({ reportKey: 'r', overlayJson: JSON.stringify({ schemaVersion: 1, reportKey: 'r', baseVersion: '2.0.0', suppress: ['detail-text'], insert: [], setProps: [] }), baseVersion: '2.0.0', isEnabled: true, updatedAt: '2026-08-16T00:00:00Z' });

    const { result } = render({ schemaVersion: 1, reportKey: 'r', baseVersion: '1.0.0', suppress: ['detail-text'] });
    expect(result.current.baseVersionOutdated).toBe(true);

    let error: string | null | undefined;
    await act(async () => { error = await result.current.save(); });
    expect(error).toBeNull();
    expect(mockValidate).toHaveBeenCalledTimes(1);
    expect(mockPut).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.baseVersionOutdated).toBe(false));
    expect(result.current.dirty).toBe(false);
  });

  it('surfaces server merge warnings from a save into the shell warnings', async () => {
    mockValidate.mockResolvedValue({
      valid: true, errors: [],
      warnings: [{ code: 'SuppressBlocked', patchId: null, targetId: 'col-a', message: 'last column cannot be removed' }],
    });
    mockPut.mockResolvedValue({ valid: true, errors: [], warnings: [] });
    mockGet.mockResolvedValue({
      reportKey: 'r', baseVersion: '2.0.0', isEnabled: true, updatedAt: '2026-08-16T00:00:00Z',
      overlayJson: JSON.stringify({ schemaVersion: 1, reportKey: 'r', suppress: [], insert: [], setProps: [] }),
    });

    const { result } = render();
    // No client-side warning for this yet — it only comes back from the server.
    expect(result.current.warnings.some((w) => w.code === 'SuppressBlocked')).toBe(false);
    await act(async () => { await result.current.save(); });
    await waitFor(() => expect(
      result.current.warnings.some((w) => w.code === 'SuppressBlocked' && w.targetId === 'col-a'),
    ).toBe(true));
  });

  it('save reports fatal validation errors and does not PUT', async () => {
    mockValidate.mockResolvedValue({ valid: false, errors: ['boom'], warnings: [] });
    const { result } = render();
    act(() => result.current.editing.setProp('detail-text', 'text', 'x', undefined));
    let error: string | null | undefined;
    await act(async () => { error = await result.current.save(); });
    expect(error).toBe('boom');
    expect(result.current.saveError).toBe('boom');
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('revert deletes the overlay and clears state', async () => {
    mockDelete.mockResolvedValue(undefined);
    const { result } = render({ schemaVersion: 1, reportKey: 'r', suppress: ['detail-text'] });
    let error: string | null | undefined;
    await act(async () => { error = await result.current.revert(); });
    expect(error).toBeNull();
    expect(mockDelete).toHaveBeenCalledWith('r');
    expect(JSON.parse(result.current.overlayJson).suppress).toEqual([]);
  });

  // Regression: save()/revert() used to resolve a plain boolean, forcing callers to read the
  // error back off `saveError` after the await — a stale closure trap (see DesignerShell.tsx's
  // handleSave/handleRevert). Resolving the error directly removes the trap structurally: two
  // consecutive failed saves with DIFFERENT errors must each report their OWN error, never the
  // previous attempt's.
  it('save resolves each attempt\'s own error, never a previous attempt\'s', async () => {
    mockValidate.mockResolvedValueOnce({ valid: false, errors: ['first failure'], warnings: [] });
    const { result } = render();

    let error: string | null | undefined;
    await act(async () => { error = await result.current.save(); });
    expect(error).toBe('first failure');

    mockValidate.mockResolvedValueOnce({ valid: false, errors: ['second failure'], warnings: [] });
    await act(async () => { error = await result.current.save(); });
    expect(error).toBe('second failure');
  });
});
