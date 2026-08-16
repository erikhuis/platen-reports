namespace PlatenReports.Model;

/// <summary>
/// Typed, validated in-memory form of a report definition. Produced by the parser from the
/// merged (base definition + customisation overlay) JSON document and consumed by a renderer.
/// </summary>
public sealed class ReportDocumentModel
{
    /// <summary>Stable identifier for this report, e.g. <c>work-order-print</c>.</summary>
    public required string Key { get; init; }

    /// <summary>The definition's own version, owned by whoever publishes it.</summary>
    public required string Version { get; init; }

    /// <summary>Display title, per locale.</summary>
    public required LocalizedText Title { get; init; }

    /// <summary>Names the data provider that supplies this report's data.</summary>
    public required string DataSource { get; init; }

    /// <summary>Optional host permission required to render, e.g. <c>Orders.View</c>. The host decides what it means.</summary>
    public string? RequiredPermission { get; init; }

    /// <summary>Paper size, orientation and margin.</summary>
    public ReportPageSetup Page { get; init; } = new();

    /// <summary>Document-wide style defaults; individual elements override.</summary>
    public ReportStyle? DefaultStyle { get; init; }

    /// <summary>The inputs this report expects, declared for callers and editors.</summary>
    public IReadOnlyList<ReportParameterDefinition> Parameters { get; init; } = [];

    /// <summary>Drawn at the top of every page.</summary>
    public ReportElement? PageHeader { get; init; }

    /// <summary>The flowing content.</summary>
    public IReadOnlyList<ReportElement> Body { get; init; } = [];

    /// <summary>Drawn at the bottom of every page.</summary>
    public ReportElement? PageFooter { get; init; }
}

/// <summary>Paper geometry for a rendered document.</summary>
public sealed class ReportPageSetup
{
    /// <summary><c>A4</c> or <c>Letter</c>.</summary>
    public string Size { get; init; } = "A4";

    /// <summary><c>portrait</c> or <c>landscape</c>.</summary>
    public string Orientation { get; init; } = "portrait";

    /// <summary>Margin in points, applied to all four edges.</summary>
    public double Margin { get; init; } = 24;
}

/// <summary>
/// Flat visual style bag shared by all element types. Every member is optional; unset members
/// inherit the renderer's defaults, plus the document's <see cref="ReportDocumentModel.DefaultStyle"/>.
/// </summary>
public sealed class ReportStyle
{
    /// <summary>Text size in points.</summary>
    public double? FontSize { get; init; }

    /// <summary>Bold weight.</summary>
    public bool? Bold { get; init; }

    /// <summary>Italic slant.</summary>
    public bool? Italic { get; init; }

    /// <summary>Text colour as a hex string.</summary>
    public string? Color { get; init; }

    /// <summary>Fill colour as a hex string.</summary>
    public string? BackgroundColor { get; init; }

    /// <summary><c>left</c>, <c>center</c> or <c>right</c>.</summary>
    public string? Align { get; init; }

    /// <summary>Padding in points on all four edges. The per-edge members override it.</summary>
    public double? Padding { get; init; }

    /// <summary>Top padding in points.</summary>
    public double? PaddingTop { get; init; }

    /// <summary>Bottom padding in points.</summary>
    public double? PaddingBottom { get; init; }

    /// <summary>Left padding in points.</summary>
    public double? PaddingLeft { get; init; }

    /// <summary>Right padding in points.</summary>
    public double? PaddingRight { get; init; }

    /// <summary>Top border thickness in points.</summary>
    public double? BorderTop { get; init; }

    /// <summary>Bottom border thickness in points.</summary>
    public double? BorderBottom { get; init; }

    /// <summary>Left border thickness in points.</summary>
    public double? BorderLeft { get; init; }

    /// <summary>Right border thickness in points.</summary>
    public double? BorderRight { get; init; }

    /// <summary>Border colour as a hex string.</summary>
    public string? BorderColor { get; init; }
}

/// <summary>
/// A label value that is either a plain string (<c>"Status"</c>) or a locale map
/// (<c>{"en":"Status","nl":"Status"}</c>).
/// </summary>
/// <remarks>
/// Resolution falls back from the full tag to its primary subtag (<c>nl-NL</c> → <c>nl</c>),
/// then to <see cref="FallbackLocale"/>, then to the first entry present. A definition author
/// can therefore ship one locale and every caller still gets text.
/// </remarks>
public sealed class LocalizedText
{
    /// <summary>The locale tried after an exact and primary-subtag match both miss.</summary>
    public const string FallbackLocale = "en";

    private readonly string? _single;
    private readonly IReadOnlyDictionary<string, string>? _map;

    /// <summary>Creates a value that reads the same in every locale.</summary>
    /// <param name="value">The text.</param>
    public LocalizedText(string value) => _single = value;

    /// <summary>Creates a per-locale value.</summary>
    /// <param name="map">Locale tag to text, e.g. <c>{"en":"Status"}</c>.</param>
    public LocalizedText(IReadOnlyDictionary<string, string> map) => _map = map;

    /// <summary>The empty value; resolves to <see cref="string.Empty"/> in every locale.</summary>
    public static readonly LocalizedText Empty = new(string.Empty);

    /// <summary>Resolves the text for a locale.</summary>
    /// <param name="locale">A locale tag such as <c>nl</c> or <c>nl-NL</c>.</param>
    /// <returns>The best available text, or <see cref="string.Empty"/> when there is none.</returns>
    public string Resolve(string locale)
    {
        if (_single is not null)
        {
            return _single;
        }

        if (_map is null || _map.Count == 0)
        {
            return string.Empty;
        }

        if (_map.TryGetValue(locale, out var exact))
        {
            return exact;
        }
        // "nl-NL" → "nl": callers pass full tags while definitions carry two-letter keys.
        var dash = locale.IndexOf('-');
        if (dash > 0 && _map.TryGetValue(locale[..dash], out var primary))
        {
            return primary;
        }

        if (_map.TryGetValue(FallbackLocale, out var fallback))
        {
            return fallback;
        }

        return _map.Values.First();
    }
}

/// <summary>Declares one input a report's data provider expects.</summary>
/// <param name="Name">Parameter name, as it appears in the request.</param>
/// <param name="Type">One of <c>guid</c>, <c>string</c>, <c>int</c>, <c>decimal</c>, <c>date</c>, <c>bool</c>.</param>
/// <param name="Required">Whether a render may proceed without it.</param>
/// <param name="Label">Optional display label for editors and prompts.</param>
public sealed record ReportParameterDefinition(
    string Name,
    string Type,
    bool Required,
    LocalizedText? Label = null);
