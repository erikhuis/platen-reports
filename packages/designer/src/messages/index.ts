/**
 * The designer's own message catalogue, in the four locales the package ships.
 *
 * The package resolves its own wording rather than assuming a host's i18n setup: element labels
 * are looked up dynamically as `elementType.<type>` and validation problems through a code → key
 * map, so a host cannot know the full key set by reading call sites. A host merges the bundle for
 * its locale into whatever its translator reads, or supplies a translator backed by these
 * directly. `messages.test.ts` is the guard that every element type and every problem code
 * resolves in all four.
 */

import de from './de.json';
import en from './en.json';
import es from './es.json';
import nl from './nl.json';

/** One locale's messages: flat keys plus the nested `elementType` labels. */
export interface DesignerMessages {
  elementType: Record<string, string>;
  [key: string]: string | Record<string, string>;
}

/** Every bundle the package ships, keyed by locale. */
export const DESIGNER_MESSAGES: Record<string, DesignerMessages> = {
  de: de as DesignerMessages,
  en: en as DesignerMessages,
  es: es as DesignerMessages,
  nl: nl as DesignerMessages,
};

/** The locales this package ships wording for. */
export const DESIGNER_LOCALES = Object.keys(DESIGNER_MESSAGES);

/**
 * A translator over one bundle — enough to mount the designer without any i18n library.
 * Resolves dotted keys (`elementType.text`) and interpolates `{name}` placeholders.
 */
export function createDesignerTranslate(locale: string) {
  const bundle = DESIGNER_MESSAGES[locale] ?? DESIGNER_MESSAGES.en!;
  return (key: string, values?: Record<string, string | number>): string => {
    const dot = key.indexOf('.');
    const raw = dot === -1
      ? bundle[key]
      : (bundle[key.slice(0, dot)] as Record<string, string> | undefined)?.[key.slice(dot + 1)];
    // Returning the key is what an i18n library does, and it is what the catalogue tests look
    // for: a raw `elementType.foo` on screen is the visible symptom of a missing entry.
    if (typeof raw !== 'string') return key;
    return values
      ? raw.replace(/\{(\w+)\}/g, (m, name: string) => String(values[name] ?? m))
      : raw;
  };
}
