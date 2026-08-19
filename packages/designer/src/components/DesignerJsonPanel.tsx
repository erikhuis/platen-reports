'use client';

/**
 * Issue #2162 slice A — dockable read-only JSON panel (Standard | Effective tabs),
 * live-synced with the designer selection: the selected element's JSON object is
 * highlighted (#FEF9C3 + #FDE047 ring) and auto-scrolled into view.
 *
 * Implementation note: the issue allows "a highlighted block if simpler" instead of
 * CodeMirror decorations. The shared <CodeEditor> primitive does not expose its
 * EditorView (needed both to dispatch `scrollIntoView` and to reconfigure a
 * decoration per selection), so this renders a plain mono <pre> split into
 * before / highlight / after segments via `findJsonObjectRange`, with ref-driven
 * auto-scroll — the simpler, robust option.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Box, IconButton, Tab, Tabs, Tooltip } from '@mui/material';
import { Check, Copy } from 'lucide-react';
import { useDesignerT } from '../designerContext';
import { findJsonObjectRange } from '@platen-reports/model';
import { MONO_FONT as MONO, TEAL } from './designerConstants';

const COPIED_RESET_MS = 1200;
/** Scroll offset so the highlighted object sits comfortably below the panel top. */
const SCROLL_MARGIN_PX = 80;

// Token colors per the prototype JsonView (design handoff app.jsx).
const KEY_COLOR = '#0369A1';
const STRING_COLOR = '#15803D';
const LITERAL_COLOR = '#B45309';

/** Quoted string (optionally a key when followed by a colon), number, or true/false/null. */
const JSON_TOKEN =
  /("(?:[^"\\]|\\.)*")(\s*:)?|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\b(?:true|false|null)\b/g;

/**
 * Lightweight syntax coloring for a rendered JSON segment: property keys,
 * string values, and number/boolean/null literals become colored spans; all
 * other text (punctuation, whitespace) passes through unstyled. Plain React
 * nodes — jsdom-safe, no dangerouslySetInnerHTML.
 */
function colorizeJson(segment: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = new RegExp(JSON_TOKEN.source, 'g');
  let last = 0;
  let spanIndex = 0;
  for (let match = regex.exec(segment); match; match = regex.exec(segment)) {
    if (match.index > last) nodes.push(segment.slice(last, match.index));
    const [token, quoted, colon] = match;
    if (quoted !== undefined) {
      const isKey = colon !== undefined;
      nodes.push(
        <span
          key={`${keyPrefix}-${spanIndex++}`}
          data-json-token={isKey ? 'key' : 'string'}
          style={{ color: isKey ? KEY_COLOR : STRING_COLOR }}
        >
          {quoted}
        </span>,
      );
      if (colon) nodes.push(colon);
    } else {
      nodes.push(
        <span
          key={`${keyPrefix}-${spanIndex++}`}
          data-json-token="literal"
          style={{ color: LITERAL_COLOR }}
        >
          {token}
        </span>,
      );
    }
    last = match.index + token.length;
  }
  if (last < segment.length) nodes.push(segment.slice(last));
  return nodes;
}

type JsonTab = 'overlay' | 'standard' | 'effective';

export interface DesignerJsonPanelProps {
  standardJson: string;
  effectiveJson: string;
  selectedId: string;
  /** Issue #2163 — the tenant overlay patch document; when set, an Overlay tab appears. */
  overlayJson?: string;
}

export default function DesignerJsonPanel({ standardJson, effectiveJson, selectedId, overlayJson }: DesignerJsonPanelProps) {
  const t = useDesignerT();
  // In tenant mode the Overlay patch is the thing being edited, so it leads; otherwise
  // the canvas/outline render the effective document, so it is the default view.
  const [tab, setTab] = useState<JsonTab>(overlayJson !== undefined ? 'overlay' : 'effective');
  const [copied, setCopied] = useState(false);

  const activeJson = tab === 'overlay' ? (overlayJson ?? '') : tab === 'standard' ? standardJson : effectiveJson;
  const range = useMemo(() => findJsonObjectRange(activeJson, selectedId), [activeJson, selectedId]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const highlightRef = useRef<HTMLSpanElement | null>(null);
  const copiedResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-scroll the highlighted object into view whenever the selection (or the
  // displayed document) changes.
  useEffect(() => {
    const container = containerRef.current;
    const highlight = highlightRef.current;
    if (!container || !highlight || !range) return;
    if (typeof container.scrollTo !== 'function') return; // jsdom
    container.scrollTo({ top: Math.max(0, highlight.offsetTop - SCROLL_MARGIN_PX), behavior: 'smooth' });
  }, [range]);

  useEffect(() => () => {
    if (copiedResetRef.current) clearTimeout(copiedResetRef.current);
  }, []);

  const handleCopy = async () => {
    // Success feedback only when the clipboard write actually lands — an
    // unavailable clipboard or a rejected write must never flash a green check.
    if (!navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(activeJson);
    } catch {
      return;
    }
    setCopied(true);
    if (copiedResetRef.current) clearTimeout(copiedResetRef.current);
    copiedResetRef.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
  };

  return (
    <Box
      data-testid="designer-json-panel"
      sx={{
        width: 'min(360px, 26vw)', flexShrink: 0, height: '100%', minHeight: 0,
        display: 'flex', flexDirection: 'column',
        bgcolor: 'background.paper', borderLeft: 1, borderRight: 1, borderColor: 'divider',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', borderBottom: 1, borderColor: 'divider', pr: 0.5 }}>
        <Tabs
          value={tab}
          onChange={(_, value: JsonTab) => setTab(value)}
          sx={{ flexGrow: 1, minHeight: 36 }}
        >
          {overlayJson !== undefined && (
            <Tab
              value="overlay"
              label={t('designerJsonTabOverlay')}
              sx={{ minHeight: 36, minWidth: 0, py: 0, px: 1.5, fontSize: 12 }}
            />
          )}
          <Tab
            value="standard"
            label={t('designerJsonTabStandard')}
            sx={{ minHeight: 36, minWidth: 0, py: 0, px: 1.5, fontSize: 12 }}
          />
          <Tab
            value="effective"
            label={t('designerJsonTabEffective')}
            sx={{ minHeight: 36, minWidth: 0, py: 0, px: 1.5, fontSize: 12 }}
          />
        </Tabs>
        <Tooltip title={copied ? t('designerJsonCopied') : t('designerJsonCopy')}>
          <IconButton
            size="small"
            onClick={() => { void handleCopy(); }}
            aria-label={t('designerJsonCopy')}
            data-testid="designer-json-copy"
          >
            {copied ? <Check size={14} color={TEAL} /> : <Copy size={14} />}
          </IconButton>
        </Tooltip>
      </Box>

      {/* position:relative makes this the highlight span's offsetParent, so
          `highlight.offsetTop − 80` is measured in the scroll container's own
          coordinate space (not the page root) and the scroll margin stays true. */}
      <Box ref={containerRef} sx={{ position: 'relative', flexGrow: 1, minHeight: 0, overflow: 'auto', bgcolor: '#FCFCFD' }}>
        <Box
          component="pre"
          data-testid="designer-json-content"
          sx={{ m: 0, px: 1.75, py: 1.5, fontFamily: MONO, fontSize: 11, lineHeight: 1.55, whiteSpace: 'pre', color: '#334155' }}
        >
          {range ? (
            <>
              {colorizeJson(activeJson.slice(0, range.from), 'before')}
              <Box
                component="span"
                ref={highlightRef}
                data-testid="designer-json-highlight"
                sx={{ bgcolor: '#FEF9C3', borderRadius: '3px', boxShadow: '0 0 0 1px #FDE047' }}
              >
                {colorizeJson(activeJson.slice(range.from, range.to), 'highlight')}
              </Box>
              {colorizeJson(activeJson.slice(range.to), 'after')}
            </>
          ) : (
            colorizeJson(activeJson, 'all')
          )}
        </Box>
      </Box>
    </Box>
  );
}
