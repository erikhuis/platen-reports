'use client';

/**
 * Save-as-export for a published definition.
 *
 * There is deliberately no write API for published definitions — they are artefacts a host
 * deploys, not rows it updates — so the designer hands the author the JSON to commit. Download
 * plus copy-to-clipboard, and a note that the host's own parser and tests are the authoritative
 * gate once the file lands. Export stays disabled while client-side validation reports problems.
 */

import { useRef, useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography,
} from '@mui/material';
import { Check, Copy, Download } from 'lucide-react';
import { useDesignerT, useReportDesigner } from '../designerContext';
import { MONO_FONT } from './designerConstants';

export interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  fileName: string;
  json: string;
  /** Client-validation problem count; export is blocked while > 0. */
  problemCount: number;
}

export default function ExportDialog({ open, onClose, fileName, json, problemCount }: ExportDialogProps) {
  const t = useDesignerT();
  const { definitionDirectory } = useReportDesigner();
  const [copied, setCopied] = useState(false);
  const copiedResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasProblems = problemCount > 0;

  const handleDownload = () => {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    if (!navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(json);
    } catch {
      return;
    }
    setCopied(true);
    if (copiedResetRef.current) clearTimeout(copiedResetRef.current);
    copiedResetRef.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth data-testid="designer-export-dialog">
      <DialogTitle>{t('designerExportTitle')}</DialogTitle>
      <DialogContent>
        {hasProblems ? (
          <Alert severity="error" data-testid="designer-export-blocked">
            {t('designerExportBlocked', { count: problemCount })}
          </Alert>
        ) : (
          <>
            <Typography variant="body2" sx={{ mb: 1.5 }}>
              {t('designerExportHint')}
            </Typography>
            <Box sx={{
              fontFamily: MONO_FONT, fontSize: 12, bgcolor: 'action.hover', borderRadius: 1,
              px: 1, py: 0.5, mb: 1.5, display: 'inline-block',
            }} data-testid="designer-export-path">
              {definitionDirectory ? `${definitionDirectory.replace(/\/$/, '')}/${fileName}` : fileName}
            </Box>
            <Alert severity="info" sx={{ fontSize: 12 }}>
              {t('designerExportValidationNote')}
            </Alert>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('back')}</Button>
        <Button
          startIcon={copied ? <Check size={16} /> : <Copy size={16} />}
          disabled={hasProblems}
          onClick={handleCopy}
          data-testid="designer-export-copy"
        >
          {copied ? t('designerJsonCopied') : t('designerExportCopy')}
        </Button>
        <Button
          variant="contained"
          startIcon={<Download size={16} />}
          disabled={hasProblems}
          onClick={handleDownload}
          data-testid="designer-export-download"
        >
          {t('designerExportDownload')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
