namespace PlatenReports.Model;

/// <summary>
/// Base of every renderable node in a report definition. The <see cref="Id"/> is required,
/// unique within the document, and is the anchor customisation overlays address — treat ids in
/// published definitions as a public contract, because renaming one silently breaks every
/// overlay that patched it.
/// </summary>
public abstract class ReportElement
{
    /// <summary>Document-unique id. Overlay patches address elements by this value.</summary>
    public required string Id { get; init; }

    /// <summary>Optional condition expression; the element is hidden when it evaluates false (null-as-false).</summary>
    public string? VisibleIf { get; init; }

    /// <summary>Visual style overrides for this element.</summary>
    public ReportStyle? Style { get; init; }

    /// <summary>Relative width when the element is a direct child of a row.</summary>
    public double? Weight { get; init; }

    /// <summary>Fixed width in points when the element is a direct child of a row.</summary>
    public double? Width { get; init; }
}

/// <summary>Free text rendered as a template against the current data scope.</summary>
public sealed class TextElement : ReportElement
{
    /// <summary>The template text, per locale.</summary>
    public required LocalizedText Text { get; init; }
}

/// <summary>A single bound value: dotted path into the data tree plus optional .NET format string.</summary>
public sealed class FieldElement : ReportElement
{
    /// <summary>Dotted path into the data tree, e.g. <c>order.customer.name</c>.</summary>
    public required string Path { get; init; }

    /// <summary>.NET format string applied to the resolved value, e.g. <c>N2</c> or <c>yyyy-MM-dd</c>.</summary>
    public string? Format { get; init; }

    /// <summary>Rendered instead of an empty value. Nothing is drawn when this is unset.</summary>
    public LocalizedText? EmptyText { get; init; }

    /// <summary>
    /// When true, the resolved (non-empty) value is parsed as markdown-lite and rendered with
    /// formatting — bold, italic, lists, line breaks and https links — instead of raw text.
    /// </summary>
    public bool Markdown { get; init; }
}

/// <summary>Lays its children out horizontally, side by side.</summary>
public sealed class RowElement : ReportElement
{
    /// <summary>The elements placed across the row, left to right.</summary>
    public IReadOnlyList<ReportElement> Children { get; init; } = [];
}

/// <summary>Stacks its children vertically.</summary>
public sealed class ColumnElement : ReportElement
{
    /// <summary>The elements stacked in the column, top to bottom.</summary>
    public IReadOnlyList<ReportElement> Children { get; init; } = [];

    /// <summary>Gap in points between children.</summary>
    public double? Spacing { get; init; }
}

/// <summary>
/// A card: bordered box, optional shaded title band, padded content. A
/// <see cref="WidthMode"/> of <c>"half"</c> makes consecutive half-width containers at the
/// same level pair up two per row at equal height; <c>"full"</c> spans the page.
/// </summary>
public sealed class ContainerElement : ReportElement
{
    /// <summary>Optional heading drawn in the card's title band.</summary>
    public LocalizedText? Title { get; init; }

    /// <summary><c>"full"</c> (default) or <c>"half"</c>. Distinct from the base fixed-point <see cref="ReportElement.Width"/>.</summary>
    public string WidthMode { get; init; } = "full";

    /// <summary>The elements inside the card.</summary>
    public IReadOnlyList<ReportElement> Children { get; init; } = [];

    /// <summary>Gap in points between children.</summary>
    public double? Spacing { get; init; }
}

/// <summary>A repeating table over a bound collection.</summary>
public sealed class TableElement : ReportElement
{
    /// <summary>Dotted path to the collection this table repeats over.</summary>
    public required string Bind { get; init; }

    /// <summary>The columns, left to right.</summary>
    public IReadOnlyList<TableColumnDefinition> Columns { get; init; } = [];

    /// <summary>Optional dotted path relative to the row item; rows are grouped by its value with a spanning group-header row.</summary>
    public string? GroupBy { get; init; }

    /// <summary>Grand totals over all rows, rendered as the table's final row.</summary>
    public IReadOnlyList<TableTotalDefinition> Totals { get; init; } = [];

    /// <summary>Per-group subtotals, rendered after each group. Requires <see cref="GroupBy"/>.</summary>
    public IReadOnlyList<TableTotalDefinition> GroupTotals { get; init; } = [];

    /// <summary>Rendered in place of the table body when the bound collection is empty.</summary>
    public LocalizedText? EmptyText { get; init; }

    /// <summary>Whether the header row repeats at the top of each page.</summary>
    public bool RepeatHeader { get; init; } = true;
}

/// <summary>
/// One table column. Either <see cref="Path"/> (bound value) or <see cref="Template"/>
/// supplies the cell text.
/// </summary>
public sealed class TableColumnDefinition
{
    /// <summary>Document-unique id; totals reference columns by it, and overlays address it.</summary>
    public required string Id { get; init; }

    /// <summary>Header cell text, per locale.</summary>
    public required LocalizedText Header { get; init; }

    /// <summary>Dotted path relative to the row item.</summary>
    public string? Path { get; init; }

    /// <summary>Template evaluated against the row item, as an alternative to <see cref="Path"/>.</summary>
    public LocalizedText? Template { get; init; }

    /// <summary>.NET format string applied to the resolved value.</summary>
    public string? Format { get; init; }

    /// <summary>Relative width of this column.</summary>
    public double? Weight { get; init; }

    /// <summary>Fixed width in points.</summary>
    public double? Width { get; init; }

    /// <summary><c>left</c> (default), <c>center</c> or <c>right</c>.</summary>
    public string? Align { get; init; }
}

/// <summary>An aggregate rendered in a table's totals or group-totals row.</summary>
public sealed class TableTotalDefinition
{
    /// <summary>Id of the <see cref="TableColumnDefinition"/> this total sits under.</summary>
    public required string ColumnId { get; init; }

    /// <summary><c>sum</c> or <c>count</c>.</summary>
    public required string Aggregate { get; init; }

    /// <summary>.NET format string applied to the aggregate.</summary>
    public string? Format { get; init; }

    /// <summary>Optional caption drawn alongside the value.</summary>
    public LocalizedText? Label { get; init; }
}

/// <summary>A label/value block, typically used for document headers.</summary>
public sealed class KeyValueGridElement : ReportElement
{
    /// <summary>The label/value pairs, in reading order.</summary>
    public IReadOnlyList<KeyValuePairDefinition> Pairs { get; init; } = [];

    /// <summary>How many label/value pairs sit side by side per printed row.</summary>
    public int Columns { get; init; } = 2;
}

/// <summary>One label/value pair in a <see cref="KeyValueGridElement"/>.</summary>
public sealed class KeyValuePairDefinition
{
    /// <summary>Document-unique id; overlays address the pair by it.</summary>
    public required string Id { get; init; }

    /// <summary>The label text, per locale.</summary>
    public required LocalizedText Label { get; init; }

    /// <summary>Dotted path into the data tree.</summary>
    public string? Path { get; init; }

    /// <summary>Template evaluated against the current scope, as an alternative to <see cref="Path"/>.</summary>
    public LocalizedText? Template { get; init; }

    /// <summary>.NET format string applied to the resolved value.</summary>
    public string? Format { get; init; }

    /// <summary>Same markdown-lite rendering opt-in as <see cref="FieldElement.Markdown"/>.</summary>
    public bool Markdown { get; init; }
}

/// <summary>Vertical whitespace.</summary>
public sealed class SpacerElement : ReportElement
{
    /// <summary>Height in points.</summary>
    public double Height { get; init; } = 8;
}

/// <summary>A horizontal rule.</summary>
public sealed class LineElement : ReportElement
{
    /// <summary>Stroke thickness in points.</summary>
    public double Thickness { get; init; } = 0.5;

    /// <summary>Stroke colour as a hex string; the renderer's default when unset.</summary>
    public string? Color { get; init; }
}

/// <summary>
/// An image resolved by name through the host's asset provider. Renders nothing when the
/// source is unknown or has no bytes.
/// </summary>
public sealed class ImageElement : ReportElement
{
    /// <summary>
    /// The asset name handed to <c>IReportAssetProvider</c>. Host-defined;
    /// <c>tenantLogo</c> is the conventional name for "the branding logo for this document".
    /// </summary>
    public string Source { get; init; } = "tenantLogo";

    /// <summary>Drawn height in points; the renderer's default when unset.</summary>
    public double? Height { get; init; }
}

/// <summary>
/// Page counter. Only valid inside the page header or page footer. Template placeholders:
/// <c>{page}</c> and <c>{total}</c>.
/// </summary>
public sealed class PageNumberElement : ReportElement
{
    /// <summary>The counter text, with <c>{page}</c> and <c>{total}</c> substituted.</summary>
    public string Template { get; init; } = "{page} / {total}";
}
