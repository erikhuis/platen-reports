'use client';

/**
 * Issue #2162 slice A — Preview tab: replaces outline+inspector with a single
 * centered page rendering the REAL server PDF (`POST /reports/{key}/preview`,
 * blob URL → iframe), parameterized from the report's catalogue metadata.
 *
 * Mirrors the raw editor page's fixed preview lifecycle (#2150 lessons): a monotonic
 * request-id ref discards stale responses, the displayed URL is revoked on
 * replace/unmount, and the loading spinner is reset on every early return so it can
 * never stick on. Since #2445 the client returns a Blob and this component owns the
 * object URL end to end, so a discarded response never mints one in the first place.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, CircularProgress, Stack, TextField } from '@mui/material';
import { useReportDesigner } from '../designerContext';
import type { ReportCatalogueItem } from '@platen-reports/model';
import type { DesignerLanguage } from '@platen-reports/model';

const PREVIEW_DEBOUNCE_MS = 900;

export interface DesignerPreviewTabProps {
  reportKey: string;
  report: ReportCatalogueItem | null;
  /** The header language seg — the LocalizedText display language, NOT the UI locale. */
  lang: DesignerLanguage;
  /** Issue #2164 — a draft standard definition to preview instead of the stored report
   *  (structural authoring). When set, the preview renders these un-committed edits. */
  draftDefinitionJson?: string;
}

export default function DesignerPreviewTab({ reportKey, report, lang, draftDefinitionJson }: DesignerPreviewTabProps) {
  const { t, api } = useReportDesigner();

  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const previewUrlRef = useRef<string | null>(null);
  // Monotonic request id: only the latest preview response may land.
  const requestIdRef = useRef(0);
  const prevKeyRef = useRef(reportKey);

  // The report switcher can change [key] without remounting this component — drop
  // all per-report state so the previous report's parameters/PDF never bleed over.
  useEffect(() => {
    if (prevKeyRef.current === reportKey) return;
    prevKeyRef.current = reportKey;
    requestIdRef.current += 1;
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setParamValues({});
    setPreviewUrl(null);
    setPreviewError(null);
    setPreviewLoading(false);
  }, [reportKey]);

  // In standard authoring the draft can add/rename/remove parameters, so the preview bar must
  // follow the DRAFT's parameters (posted to /preview), not the stored catalogue metadata — else
  // a renamed required param can never be filled. Falls back to the catalogue when there is no
  // draft or it is mid-edit invalid JSON.
  const effectiveParameters = useMemo((): { name: string; required: boolean }[] => {
    if (draftDefinitionJson) {
      try {
        const parsed = JSON.parse(draftDefinitionJson) as { parameters?: { name?: string; required?: boolean }[] };
        return (parsed.parameters ?? [])
          .filter((p): p is { name: string; required?: boolean } => typeof p.name === 'string' && p.name.length > 0)
          .map((p) => ({ name: p.name, required: Boolean(p.required) }));
      } catch {
        return [];
      }
    }
    return (report?.parameters ?? []).map((p) => ({ name: p.name, required: p.required }));
  }, [draftDefinitionJson, report]);

  const requiredParamsFilled = useMemo(() =>
    effectiveParameters
      .filter((parameter) => parameter.required)
      .every((parameter) => (paramValues[parameter.name] ?? '').trim().length > 0),
  [effectiveParameters, paramValues]);

  // Debounced render of the real PDF. `overlayJson: null` — the server renders the
  // effective definition; this read-only slice carries no draft. The locale argument
  // is the designer's language seg (LocalizedText display language) so the server PDF
  // matches what the design canvas shows.
  useEffect(() => {
    if (!requiredParamsFilled) {
      // No render is coming for this state — clear the spinner/error a previous run left on.
      setPreviewLoading(false);
      setPreviewError(null);
      return;
    }
    setPreviewLoading(true);
    const requestId = ++requestIdRef.current;
    const handle = setTimeout(() => {
      api.previewPdf({
        key: reportKey, overlayJson: null, definitionJson: draftDefinitionJson,
        parameters: paramValues, locale: lang,
      })
        .then((blob) => {
          // #2445 — the client hands back a Blob and this component owns the object URL for
          // its whole life: created here, revoked on replacement, staleness and unmount.
          if (requestId !== requestIdRef.current) return; // superseded — nothing created yet
          const url = URL.createObjectURL(blob);
          if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
          previewUrlRef.current = url;
          setPreviewUrl(url);
          setPreviewError(null);
          setPreviewLoading(false);
        })
        .catch((e: Error) => {
          if (requestId !== requestIdRef.current) return;
          setPreviewError(e.message);
          setPreviewLoading(false);
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [api, reportKey, paramValues, lang, requiredParamsFilled, draftDefinitionJson]);

  useEffect(() => () => {
    // Invalidate in-flight requests so a late response can't create a blob URL
    // nobody would ever revoke, then release the currently shown PDF.
    requestIdRef.current += 1;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  return (
    <Box
      data-testid="designer-preview-tab"
      // minWidth 0: sits in a flex row next to the (optional) docked JSON panel.
      sx={{ flexGrow: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', bgcolor: '#E2E8F0' }}
    >
      {/* Parameter bar from the effective definition (draft in standard mode, else catalogue). */}
      <Box sx={{ px: 2, py: 1.5, bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          {effectiveParameters.map((parameter) => (
            <TextField
              key={parameter.name}
              size="small"
              label={parameter.name + (parameter.required ? ' *' : '')}
              value={paramValues[parameter.name] ?? ''}
              onChange={(e) =>
                setParamValues((prev) => ({ ...prev, [parameter.name]: e.target.value }))}
            />
          ))}
        </Stack>
        {!requiredParamsFilled && (
          <Alert severity="info" sx={{ mt: 1 }} data-testid="designer-preview-hint">
            {t('previewNeedsParameters')}
          </Alert>
        )}
        {previewError && (
          <Alert severity="error" sx={{ mt: 1 }} data-testid="designer-preview-error">
            {previewError}
          </Alert>
        )}
      </Box>

      {/* Centered page at larger scale on the preview desk. */}
      <Box sx={{
        flexGrow: 1, minHeight: 0, overflow: 'auto', p: 2,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
      }}>
        {previewLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
            <CircularProgress size={20} />
          </Box>
        )}
        {previewUrl && (
          // Blob-URL iframe: the browser PDF viewer provides zoom/pagination.
          <Box
            component="iframe"
            src={previewUrl}
            title={t('previewTitle')}
            data-testid="designer-preview-frame"
            sx={{
              width: '100%', maxWidth: 920, flexGrow: 1, minHeight: 0,
              border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper',
            }}
          />
        )}
      </Box>
    </Box>
  );
}
