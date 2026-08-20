/**
 * The wire contracts a host's reporting API speaks, and the client port the designer calls.
 *
 * `ReportsApiClient` is a **port**: the designer declares what it needs and the host binds it
 * to its own transport. That inversion is what lets the designer ship without knowing how any
 * particular application authenticates, routes or serialises.
 */

// ── Wire DTOs (mirror the API's reporting DTOs) ──────────────────────────────

export interface ReportCatalogueItem {
  key: string;
  title: string;
  version: string;
  dataSource: string;
  requiredPermission: string | null;
  hasOverlay: boolean;
  overlayEnabled: boolean;
  parameters: ReportParameter[];
}

export interface ReportParameter {
  name: string;
  type: 'guid' | 'string' | 'int' | 'decimal' | 'date' | 'bool';
  required: boolean;
}

export interface ReportOverlayMergeWarning {
  code: string;
  patchId: string | null;
  targetId: string | null;
  message: string;
}

export interface ReportEffectiveDefinition {
  definitionJson: string;
  standardVersion: string;
  warnings: ReportOverlayMergeWarning[];
}

export interface ReportOverlay {
  reportKey: string;
  overlayJson: string;
  baseVersion: string | null;
  isEnabled: boolean;
  updatedAt: string;
}

export interface ReportOverlayValidationResult {
  valid: boolean;
  errors: string[];
  warnings: ReportOverlayMergeWarning[];
}

export interface ReportFieldNode {
  name: string;
  type: string;
  isCollection: boolean;
  children: ReportFieldNode[] | null;
}

// ── The API port ─────────────────────────────────────────────────────────────

export interface ReportPreviewRequest {
  key: string;
  /** Draft (unsaved) overlay, or null to render the stored effective definition. */
  overlayJson: string | null;
  /** A draft definition; takes precedence over `overlayJson`. */
  definitionJson?: string | null;
  parameters: Record<string, string>;
  /** LocalizedText display language for the rendered PDF (the designer's language seg). */
  locale: string;
  /** IANA zone stamped into the report footer. The host fills it in when omitted. */
  timeZone?: string;
}

/**
 * The binary payload `previewPdf` resolves to: the structural subset of a `Blob` this contract
 * actually needs.
 *
 * Naming `Blob` here would be an ambient dependency in the *published declarations*. `Blob` is a
 * web standard but its TypeScript declaration ships in the `DOM` lib or `@types/node`, so a
 * consumer compiling with `"lib": ["ES2022"]` and `"types": []` got `TS2304: Cannot find name
 * 'Blob'` out of our own `.d.ts`. Two defaults hid it: an unspecified `lib` pulls in DOM, and
 * `skipLibCheck: true` skips our declarations entirely — leaving exactly the Node-side consumer
 * this package targets to hit it. See #10.
 *
 * A real `Blob` satisfies this shape structurally, so hosts keep returning one and nothing
 * changes at runtime. Browser hosts should keep returning a real one:
 * `@platen-reports/designer` hands the result to `URL.createObjectURL`, which accepts no
 * substitute.
 */
export interface ReportPreviewBlob {
  readonly size: number;
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ReportsApiClient {
  listReports(): Promise<ReportCatalogueItem[]>;
  getEffectiveDefinition(key: string): Promise<ReportEffectiveDefinition>;
  getStandardDefinition(key: string): Promise<string>;
  getFields(key: string): Promise<ReportFieldNode>;
  /** Resolves to null when no overlay is stored (a 404 is not an error here). */
  getOverlay(key: string): Promise<ReportOverlay | null>;
  putOverlay(key: string, overlayJson: string, isEnabled: boolean): Promise<ReportOverlayValidationResult>;
  deleteOverlay(key: string): Promise<void>;
  validateOverlay(key: string, overlayJson: string): Promise<ReportOverlayValidationResult>;
  /**
   * Resolves to a Blob-shaped payload — the designer owns `createObjectURL`/`revokeObjectURL`.
   * Splitting that ownership across the package boundary (client creates, caller revokes)
   * leaks by default.
   */
  previewPdf(request: ReportPreviewRequest): Promise<ReportPreviewBlob>;
  /**
   * Href for an `<a target="_blank">` render link. Host-owned because the right URL differs
   * per host: one may point at a same-origin proxy, because a bare anchor navigation carries
   * no Authorization header and would be rejected; another may link the API directly.
   */
  renderUrl(key: string, parameters: Record<string, string>, locale?: string): string;
}
