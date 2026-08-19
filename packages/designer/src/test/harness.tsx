import { useRef, type ReactNode } from 'react';
import type { ReportsApiClient } from '@platen-reports/model';
import {
  ReportDesignerProvider,
  type DesignerTranslate,
  type ReportDesignerContextValue,
} from '../designerContext';
import { createDesignerTranslate } from '../messages';

/**
 * Test harness for the designer's host contract.
 *
 * Every component in this package reads its translator, `canEdit` flag, error formatter and
 * navigation callbacks from `ReportDesignerProvider`, so rendering one bare throws. Wrap with
 * one of the providers here.
 */

/**
 * Catalogue-free translator: echoes the key, appending interpolated values as
 * `key(a,b)`. Referentially stable — several designer components memoize on `t`, and a
 * fresh function per render can re-run their effects endlessly.
 */
export const designerTestT: DesignerTranslate = (key, values) =>
  values ? `${key}(${Object.values(values).join(',')})` : key;

/**
 * A `ReportsApiClient` (#2445) whose methods reject unless the test supplies them. Rejecting
 * loudly beats resolving empty: a component that calls an endpoint the test did not think
 * about fails with the method name instead of silently rendering a blank state.
 */
export function stubReportsApi(overrides: Partial<ReportsApiClient> = {}): ReportsApiClient {
  const unstubbed = (method: string) => () =>
    Promise.reject(new Error(`ReportsApiClient.${method} was called but not stubbed in this test`));
  return {
    listReports: unstubbed('listReports'),
    getEffectiveDefinition: unstubbed('getEffectiveDefinition'),
    getStandardDefinition: unstubbed('getStandardDefinition'),
    getFields: unstubbed('getFields'),
    getOverlay: unstubbed('getOverlay'),
    putOverlay: unstubbed('putOverlay'),
    deleteOverlay: unstubbed('deleteOverlay'),
    validateOverlay: unstubbed('validateOverlay'),
    previewPdf: unstubbed('previewPdf'),
    renderUrl: (key, parameters, locale) => {
      const qs = new URLSearchParams({ ...parameters, ...(locale ? { locale } : {}) }).toString();
      return `/api/reports/${encodeURIComponent(key)}/render${qs ? `?${qs}` : ''}`;
    },
    ...overrides,
  };
}

/**
 * Shared default instance. The stub is stateless, and a fresh object per render would make
 * `api` referentially unstable — the same hazard called out for `t` above, and it bites the
 * same way: `DesignerPreviewTab`'s render effect and `useOverlayEditing`'s save/revert
 * callbacks both key on `api`. Pass a module-scope client when overriding, not an inline call.
 */
const DEFAULT_STUB_API = stubReportsApi();

export type DesignerTestProviderProps =
  Partial<ReportDesignerContextValue> & { children: ReactNode };

/** Provider with the catalogue-free `designerTestT`; every field is overridable. */
export function DesignerTestProvider({ children, ...overrides }: DesignerTestProviderProps) {
  return (
    <ReportDesignerProvider t={designerTestT} locale="en" canEdit api={DEFAULT_STUB_API} {...overrides}>
      {children}
    </ReportDesignerProvider>
  );
}

/**
 * A translator over the package's own English bundle, pinned to its first instance so it stays
 * referentially stable.
 *
 * In the origin codebase this read the host application's catalogue. Here it reads the bundle
 * this package ships, which is what makes the tests that assert rendered English worth having:
 * they double as proof that the shipped wording actually resolves.
 */
export function DesignerIntlTestProvider({ children, ...overrides }: DesignerTestProviderProps) {
  const stable = useRef<DesignerTranslate>(createDesignerTranslate('en'));
  return (
    <ReportDesignerProvider t={stable.current} locale="en" canEdit api={DEFAULT_STUB_API} {...overrides}>
      {children}
    </ReportDesignerProvider>
  );
}
