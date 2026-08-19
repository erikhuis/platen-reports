'use client';

/**
 * Issue #2163 — multilingual text editor (shared primitive).
 *
 * A single primary-language TextField with a globe expander that reveals all four
 * designer locales (en/nl/de/es). Used by the report-designer inspector for every
 * localizable string (text / label / header / title / emptyText).
 *
 * String-vs-map model (documented decision):
 *  - A plain string stays a plain string while only the PRIMARY language is edited
 *    — a plain string is language-agnostic content shown for every locale.
 *  - Typing into a SECOND (non-primary) locale promotes the value to a locale map,
 *    seeding the existing plain text under the primary-language key.
 *  - Once a map, it stays a map: emptying locales prunes those entries from the
 *    emitted object but NEVER collapses back to a plain string (predictable, avoids
 *    silently discarding the per-locale structure the author just created).
 */

import { useState } from 'react';
import { Box, Collapse, IconButton, TextField, Tooltip, Typography } from '@mui/material';
import { Globe } from 'lucide-react';
import { useDesignerT } from './designerContext';
import {
  DESIGNER_LANGUAGES,
  type DesignerLanguage,
  type LocalizedTextValue,
} from '@platen-reports/model';

const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export interface LangTextProps {
  value: LocalizedTextValue | undefined;
  onChange: (value: LocalizedTextValue) => void;
  /** The primary / display language shown in the inline field. */
  lang: DesignerLanguage;
  label?: string;
  placeholder?: string;
  multiline?: boolean;
  disabled?: boolean;
}

function isMapValue(value: LocalizedTextValue | undefined): value is Record<string, string> {
  return typeof value === 'object' && value !== null;
}

/** Drop empty-string entries so the emitted locale map stays clean in the JSON. */
function pruneMap(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [locale, text] of Object.entries(map)) {
    if (text !== '') out[locale] = text;
  }
  return out;
}

export default function LangText({
  value, onChange, lang, label, placeholder, multiline = false, disabled = false,
}: LangTextProps) {
  const t = useDesignerT();
  const [open, setOpen] = useState(false);

  const map = isMapValue(value) ? value : {};
  const plain = typeof value === 'string' ? value : '';
  const asMap = isMapValue(value);

  /** The stored text for a locale (a plain string shows under the primary language). */
  const localeText = (locale: DesignerLanguage): string =>
    asMap ? (map[locale] ?? '') : (locale === lang ? plain : '');

  /** en value drives panel placeholders (fall back to en) — for a plain string it IS the value. */
  const enText = asMap ? (map.en ?? '') : plain;

  const filledCount = DESIGNER_LANGUAGES.filter((locale) =>
    asMap ? (map[locale] ?? '').trim() !== '' : (locale === lang && plain.trim() !== ''),
  ).length;

  const setLocale = (locale: DesignerLanguage, text: string) => {
    if (!asMap) {
      // Currently a plain string (or unset).
      if (locale === lang) {
        // Editing the primary language keeps it a plain string.
        onChange(text);
        return;
      }
      // A second locale was added → promote to a locale map, preserving the plain
      // text under the primary language key.
      onChange(pruneMap({ [lang]: plain, [locale]: text }));
      return;
    }
    // Already a map → stays a map.
    onChange(pruneMap({ ...map, [locale]: text }));
  };

  const otherLangs = DESIGNER_LANGUAGES;
  const primaryPlaceholder = placeholder ?? (lang !== 'en' ? enText || undefined : undefined);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, width: '100%' }}>
      {label && (
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'text.secondary' }}>{label}</Typography>
      )}
      <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start' }}>
        <TextField
          size="small"
          fullWidth
          multiline={multiline}
          minRows={multiline ? 3 : undefined}
          value={localeText(lang)}
          placeholder={primaryPlaceholder}
          disabled={disabled}
          onChange={(e) => setLocale(lang, e.target.value)}
          inputProps={{ 'aria-label': label ?? t('designerLangTextPrimary', { lang: lang.toUpperCase() }) }}
        />
        <Tooltip title={t('designerLangTextOtherLocales')}>
          <span>
            <IconButton
              size="small"
              aria-label={t('designerLangTextOtherLocales')}
              aria-expanded={open}
              disabled={disabled}
              onClick={() => setOpen((prev) => !prev)}
              color={open ? 'primary' : 'default'}
              sx={{ border: 1, borderColor: open ? 'primary.main' : 'divider', borderRadius: '8px', px: 0.75 }}
            >
              <Globe size={16} />
              <Typography component="span" sx={{ fontSize: 10, fontWeight: 700, ml: 0.25 }}>
                {filledCount}/{DESIGNER_LANGUAGES.length}
              </Typography>
            </IconButton>
          </span>
        </Tooltip>
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box
          data-testid="langtext-locales"
          sx={{
            display: 'flex', flexDirection: 'column', gap: 0.75,
            border: 1, borderColor: 'divider', borderRadius: '8px', p: 1, bgcolor: 'action.hover',
          }}
        >
          {otherLangs.map((locale) => (
            <Box key={locale} sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
              <Typography
                component="span"
                sx={{
                  fontSize: 10, fontWeight: 700, color: 'text.secondary', width: 22,
                  textTransform: 'uppercase', fontFamily: MONO_FONT, flexShrink: 0,
                }}
              >
                {locale}
              </Typography>
              <TextField
                size="small"
                fullWidth
                multiline={multiline}
                minRows={multiline ? 2 : undefined}
                value={localeText(locale)}
                placeholder={locale === 'en' ? placeholder : enText || placeholder}
                disabled={disabled}
                onChange={(e) => setLocale(locale, e.target.value)}
                inputProps={{ 'aria-label': `${label ?? ''} ${locale.toUpperCase()}`.trim() }}
              />
            </Box>
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}
