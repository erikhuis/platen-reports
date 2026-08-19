/**
 * Typed client model of a report definition.
 *
 * Mirrors the engine's own model — the eleven element types its parser accepts — so a
 * designer can never build a shape the parser would reject. Nothing here parses or renders;
 * this is the vocabulary both sides agree on.
 */

/** Plain string or an en/nl/de/es locale map (the engine's localized text). */
export type LocalizedTextValue = string | Record<string, string>;

export interface ReportStyleProps {
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  align?: string;
  color?: string;
  backgroundColor?: string;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  borderTop?: number;
  borderBottom?: number;
  borderLeft?: number;
  borderRight?: number;
  borderColor?: string;
}

interface ElementBase {
  id: string;
  visibleIf?: string;
  style?: ReportStyleProps;
  /** Relative width when a direct child of a row. */
  weight?: number;
  /** Fixed width in points when a direct child of a row. */
  width?: number;
}

export interface TextElementNode extends ElementBase {
  type: 'text';
  text: LocalizedTextValue;
}

export interface FieldElementNode extends ElementBase {
  type: 'field';
  path: string;
  format?: string;
  emptyText?: LocalizedTextValue;
}

export interface RowElementNode extends ElementBase {
  type: 'row';
  children: ReportElementNode[];
}

export interface ColumnElementNode extends ElementBase {
  type: 'column';
  children: ReportElementNode[];
  spacing?: number;
}

export interface ContainerElementNode extends Omit<ElementBase, 'width'> {
  type: 'container';
  title?: LocalizedTextValue;
  /** "full" (default) or "half" — distinct from the base fixed-point width. */
  width?: number | string;
  children: ReportElementNode[];
  spacing?: number;
}

export interface TableColumnNode {
  id: string;
  header: LocalizedTextValue;
  path?: string;
  template?: LocalizedTextValue;
  format?: string;
  weight?: number;
  width?: number;
  align?: string;
}

export interface TableTotalNode {
  columnId: string;
  aggregate: 'sum' | 'count' | string;
  format?: string;
  label?: LocalizedTextValue;
}

export interface TableElementNode extends ElementBase {
  type: 'table';
  bind: string;
  columns: TableColumnNode[];
  groupBy?: string;
  totals?: TableTotalNode[];
  groupTotals?: TableTotalNode[];
  emptyText?: LocalizedTextValue;
  repeatHeader?: boolean;
}

export interface KeyValuePairNode {
  id: string;
  label: LocalizedTextValue;
  path?: string;
  template?: LocalizedTextValue;
  format?: string;
}

export interface KeyValueGridElementNode extends ElementBase {
  type: 'keyValueGrid';
  pairs: KeyValuePairNode[];
  columns?: number;
}

export interface SpacerElementNode extends ElementBase {
  type: 'spacer';
  height?: number;
}

export interface LineElementNode extends ElementBase {
  type: 'line';
  thickness?: number;
  color?: string;
}

export interface ImageElementNode extends ElementBase {
  type: 'image';
  source?: string;
  height?: number;
}

export interface PageNumberElementNode extends ElementBase {
  type: 'pageNumber';
  template?: string;
}

export type ReportElementNode =
  | TextElementNode
  | FieldElementNode
  | RowElementNode
  | ColumnElementNode
  | ContainerElementNode
  | TableElementNode
  | KeyValueGridElementNode
  | SpacerElementNode
  | LineElementNode
  | ImageElementNode
  | PageNumberElementNode;

export type ReportElementType = ReportElementNode['type'];

export interface ReportParameterDef {
  name: string;
  type?: string;
  required?: boolean;
}

export interface ReportPageSetup {
  size?: string;
  orientation?: string;
  margin?: number;
}

export interface ReportDefinitionDoc {
  schemaVersion?: number;
  key: string;
  version: string;
  title?: LocalizedTextValue;
  dataSource?: string;
  requiredPermission?: string;
  page?: ReportPageSetup;
  /** Document-wide base text style (the server's `defaultStyle`; fontSize only today). */
  defaultStyle?: { fontSize?: number };
  parameters?: ReportParameterDef[];
  pageHeader?: ReportElementNode;
  body?: ReportElementNode[];
  pageFooter?: ReportElementNode;
}

/** Pseudo-selection id for the "Report settings" outline card / sheet background. */
export const REPORT_SETTINGS_ID = '__report-settings__';

/** Locales the designer's LocalizedText language switch offers. */
export const DESIGNER_LANGUAGES = ['en', 'nl', 'de', 'es'] as const;
export type DesignerLanguage = (typeof DESIGNER_LANGUAGES)[number];

/** Resolve a LocalizedText for display: exact language → en → first entry → ''. */
export function resolveLocalized(value: LocalizedTextValue | undefined, lang: string): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return value[lang] ?? value.en ?? Object.values(value)[0] ?? '';
}

/**
 * Defaults metadata per element type (mirrors the parser/QuestPDF defaults, documented
 * in the design handoff `report_designer/data.js`). A property equal to its default is
 * omitted from the JSON and displayed un-highlighted; the inspector's Advanced badges
 * count properties that differ.
 */
// Deliberately un-annotated: the inferred literal-key type is what makes
// `ELEMENT_DEFAULTS.text` safe for consumers under `noUncheckedIndexedAccess`. Annotating it
// as an open Record widens every access to `| undefined` and pushes a non-null assertion into
// every call site in the designer.
export const ELEMENT_DEFAULTS = {
  style: {
    fontSize: 9, bold: false, italic: false, align: 'left', color: '', backgroundColor: '',
    paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0,
    borderTop: 0, borderBottom: 0, borderLeft: 0, borderRight: 0, borderColor: '',
  },
  text: { weight: 1 },
  // height: the renderer's logo height cap — QuestPdfReportRenderer.DefaultLogoHeightCap (30).
  image: { weight: 1, height: 30 },
  pageNumber: { weight: 1, template: '{page} / {total}' },
  container: { width: 'full' },
  // columns: the server parser is the source of truth — ReportDefinitionParser.cs `?? 2`.
  keyValueGrid: { columns: 2 },
  // spacing: the renderer is the source of truth — QuestPdfReportRenderer.cs `Spacing ?? 4`.
  column: { spacing: 4 },
  spacer: { height: 8 },
  line: { thickness: 0.5 },
  table: { repeatHeader: true },
  pair: { format: '' },
  // margin: the server parser is the source of truth — ReportDefinitionParser.cs `?? 24`.
  page: { size: 'A4', orientation: 'portrait', margin: 24 },
};

/** Count how many of `keys` are present on `obj` and differ from their default. */
export function countChangedProps(
  obj: Record<string, unknown>,
  defaults: Record<string, unknown>,
  keys: string[],
): number {
  return keys.filter((k) => obj[k] !== undefined && obj[k] !== defaults[k]).length;
}

/** Child elements of a node, when it is a structural parent. */
export function childElements(node: ReportElementNode): ReportElementNode[] {
  switch (node.type) {
    case 'row':
    case 'column':
    case 'container':
      return node.children ?? [];
    default:
      return [];
  }
}

/** Depth-first walk over every element in the document (header → body → footer). */
export function* walkElements(doc: ReportDefinitionDoc): Generator<ReportElementNode> {
  function* walk(node: ReportElementNode): Generator<ReportElementNode> {
    yield node;
    for (const child of childElements(node)) yield* walk(child);
  }
  if (doc.pageHeader) yield* walk(doc.pageHeader);
  for (const node of doc.body ?? []) yield* walk(node);
  if (doc.pageFooter) yield* walk(doc.pageFooter);
}

export interface FoundSelection {
  /** The element owning the selection (the table/grid for a column/pair hit). */
  element: ReportElementNode;
  /** Set when the selected id addresses a table column. */
  column?: TableColumnNode;
  /** Set when the selected id addresses a keyValueGrid pair. */
  pair?: KeyValuePairNode;
}

/**
 * Locate a selection id anywhere in the document. Table columns and grid pairs have
 * their own ids (public overlay-anchor contract) and are selectable like elements.
 */
export function findSelection(doc: ReportDefinitionDoc, id: string): FoundSelection | null {
  for (const element of walkElements(doc)) {
    if (element.id === id) return { element };
    if (element.type === 'table') {
      const column = element.columns.find((c) => c.id === id);
      if (column) return { element, column };
    }
    if (element.type === 'keyValueGrid') {
      const pair = element.pairs.find((p) => p.id === id);
      if (pair) return { element, pair };
    }
  }
  return null;
}

/**
 * Marks every character that lies inside a JSON string literal (including its delimiting
 * quotes), so a brace-matching walk can skip `{`/`}` characters that appear in text/template
 * values rather than treating them as structural.
 */
function computeJsonStringMask(json: string): boolean[] {
  const mask = new Array<boolean>(json.length).fill(false);
  let inString = false;
  let escaped = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (inString) {
      mask[i] = true;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      mask[i] = true;
      inString = true;
    }
  }
  return mask;
}

/**
 * Character range of the object owning `"id": "<id>"` inside pretty-printed JSON, by
 * brace-matching outward from the id property — lets the JSON panel highlight and
 * scroll the selected element's object into view without a JSON AST.
 */
export function findJsonObjectRange(json: string, id: string): { from: number; to: number } | null {
  const needle = `"id": ${JSON.stringify(id)}`;
  const at = json.indexOf(needle);
  if (at < 0) return null;
  // A `{`/`}` inside a string value (report text, a `{{ template }}` expression) is not
  // structural — skip anything the mask marks as being inside a quoted string.
  const inString = computeJsonStringMask(json);
  // Walk back to the object's opening brace.
  let depth = 0;
  let from = at;
  for (let i = at; i >= 0; i--) {
    if (inString[i]) continue;
    const ch = json[i];
    if (ch === '}') depth++;
    else if (ch === '{') {
      if (depth === 0) { from = i; break; }
      depth--;
    }
  }
  // Walk forward to the matching closing brace.
  depth = 0;
  for (let i = from; i < json.length; i++) {
    if (inString[i]) continue;
    const ch = json[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return { from, to: i + 1 };
    }
  }
  return null;
}
