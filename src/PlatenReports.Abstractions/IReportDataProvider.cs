using System.Globalization;
using PlatenReports.Model;

namespace PlatenReports;

/// <summary>A curated data source for one report root.</summary>
/// <remarks>
/// Providers are the only way a report definition reaches data. The definition binds fields by
/// dotted path into the tree the provider returns and can never express its own query — which
/// is what makes a definition safe to let a customer administrator customise.
/// </remarks>
public interface IReportDataProvider
{
    /// <summary>Matches the definition's <c>dataSource</c> value.</summary>
    string Key { get; }

    /// <summary>The inputs this provider expects.</summary>
    IReadOnlyList<ReportParameterDefinition> Parameters { get; }

    /// <summary>
    /// The field tree this provider actually emits. Powers editor autocomplete and overlay path
    /// validation, so it must stay honest: a path missing here cannot be bound in the designer.
    /// </summary>
    /// <returns>The root of the field tree.</returns>
    ReportFieldNode DescribeFields();

    /// <summary>Loads the data for one render.</summary>
    /// <param name="parameters">The caller's raw parameters.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The data tree this report renders against.</returns>
    /// <exception cref="ReportParameterException">A required parameter is missing or malformed.</exception>
    /// <exception cref="KeyNotFoundException">The referenced record does not exist, or is not visible to the caller.</exception>
    Task<ReportDataContext> LoadAsync(ReportParameters parameters, CancellationToken ct);
}

/// <summary>Raw string parameters from a render or preview request, parsed on demand.</summary>
/// <remarks>
/// Every typed reader parses with <see cref="CultureInfo.InvariantCulture"/>: these are wire
/// values off a query string, not text a user typed in their own locale. Malformed input raises
/// <see cref="ReportParameterException"/>, which a host maps to a client error.
/// </remarks>
public sealed class ReportParameters
{
    private readonly IReadOnlyDictionary<string, string> _values;

    /// <summary>Wraps the raw values.</summary>
    /// <param name="values">Parameter name to raw string value.</param>
    public ReportParameters(IReadOnlyDictionary<string, string> values) => _values = values;

    /// <summary>No parameters.</summary>
    public static readonly ReportParameters Empty = new(new Dictionary<string, string>());

    /// <summary>Reads a parameter as text.</summary>
    /// <param name="name">Parameter name.</param>
    /// <returns>The value, or <see langword="null"/> when absent or blank.</returns>
    public string? GetString(string name) =>
        _values.TryGetValue(name, out var value) && !string.IsNullOrWhiteSpace(value) ? value : null;

    /// <summary>Reads a required GUID parameter.</summary>
    /// <param name="name">Parameter name.</param>
    /// <returns>The parsed value.</returns>
    /// <exception cref="ReportParameterException">Missing or not a GUID.</exception>
    public Guid GetRequiredGuid(string name)
    {
        var raw = GetString(name)
            ?? throw new ReportParameterException($"Required parameter '{name}' is missing.");
        return Guid.TryParse(raw, out var id)
            ? id
            : throw new ReportParameterException($"Parameter '{name}' must be a GUID.");
    }

    /// <summary>Reads an optional GUID parameter.</summary>
    /// <param name="name">Parameter name.</param>
    /// <returns>The parsed value, or <see langword="null"/> when absent.</returns>
    /// <exception cref="ReportParameterException">Present but not a GUID.</exception>
    public Guid? GetGuid(string name)
    {
        var raw = GetString(name);
        if (raw is null)
        {
            return null;
        }

        return Guid.TryParse(raw, out var id)
            ? id
            : throw new ReportParameterException($"Parameter '{name}' must be a GUID.");
    }

    /// <summary>Reads an optional whole-number parameter.</summary>
    /// <param name="name">Parameter name.</param>
    /// <returns>The parsed value, or <see langword="null"/> when absent.</returns>
    /// <exception cref="ReportParameterException">Present but not a whole number.</exception>
    public int? GetInt(string name)
    {
        var raw = GetString(name);
        if (raw is null)
        {
            return null;
        }

        return int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var value)
            ? value
            : throw new ReportParameterException($"Parameter '{name}' must be a whole number.");
    }

    /// <summary>Reads a required whole-number parameter.</summary>
    /// <param name="name">Parameter name.</param>
    /// <returns>The parsed value.</returns>
    /// <exception cref="ReportParameterException">Missing, or not a whole number.</exception>
    public int GetRequiredInt(string name) =>
        GetInt(name) ?? throw new ReportParameterException($"Required parameter '{name}' is missing.");

    /// <summary>Reads an optional decimal parameter.</summary>
    /// <remarks>
    /// <see cref="NumberStyles.Float"/>, deliberately not <see cref="NumberStyles.Number"/> —
    /// the latter allows thousands separators, so invariant parsing would read <c>"1,5"</c> as
    /// <b>15</b>. A European caller meaning one-and-a-half would silently get fifteen. Rejecting
    /// the separator is the only safe reading for a wire value.
    /// </remarks>
    /// <param name="name">Parameter name.</param>
    /// <returns>The parsed value, or <see langword="null"/> when absent.</returns>
    /// <exception cref="ReportParameterException">Present but not a number.</exception>
    public decimal? GetDecimal(string name)
    {
        var raw = GetString(name);
        if (raw is null)
        {
            return null;
        }

        return decimal.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var value)
            ? value
            : throw new ReportParameterException($"Parameter '{name}' must be a number.");
    }

    /// <summary>Reads a required decimal parameter.</summary>
    /// <param name="name">Parameter name.</param>
    /// <returns>The parsed value.</returns>
    /// <exception cref="ReportParameterException">Missing, or not a number.</exception>
    public decimal GetRequiredDecimal(string name) =>
        GetDecimal(name) ?? throw new ReportParameterException($"Required parameter '{name}' is missing.");

    /// <summary>Reads an optional date parameter.</summary>
    /// <remarks>
    /// <para>Parsed with <see cref="CultureInfo.InvariantCulture"/>, so the same string means the
    /// same day on every machine regardless of the server's locale. ISO-8601 —
    /// <c>yyyy-MM-dd</c> or a full round-trip timestamp — is the intended and recommended form.</para>
    /// <para><b>Sharp edge:</b> this is not ISO-8601-<em>only</em>. Any date the invariant culture
    /// accepts parses, and the invariant short-date pattern is month-first: <c>03/04/2026</c>
    /// reads as <b>4 March</b>, not 3 April. Callers building URLs from user input should
    /// normalise to <c>yyyy-MM-dd</c> rather than relying on this to reject ambiguous forms.</para>
    /// </remarks>
    /// <param name="name">Parameter name.</param>
    /// <returns>The parsed value, or <see langword="null"/> when absent.</returns>
    /// <exception cref="ReportParameterException">Present but not an ISO-8601 date.</exception>
    public DateTime? GetDate(string name)
    {
        var raw = GetString(name);
        if (raw is null)
        {
            return null;
        }

        return DateTime.TryParse(raw, CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind | DateTimeStyles.AllowWhiteSpaces, out var value)
            ? value
            : throw new ReportParameterException($"Parameter '{name}' must be an ISO-8601 date.");
    }

    /// <summary>Reads a required date parameter.</summary>
    /// <param name="name">Parameter name.</param>
    /// <returns>The parsed value.</returns>
    /// <exception cref="ReportParameterException">Missing, or not an ISO-8601 date.</exception>
    public DateTime GetRequiredDate(string name) =>
        GetDate(name) ?? throw new ReportParameterException($"Required parameter '{name}' is missing.");

    /// <summary>Reads an optional boolean parameter.</summary>
    /// <remarks>
    /// <see cref="bool.TryParse(string, out bool)"/> only, so <c>true</c>/<c>false</c> in any
    /// casing. Not <c>1</c>/<c>0</c> or <c>yes</c>/<c>no</c> — the definition schema says bool,
    /// and quietly widening the accepted spellings here would make the wire contract depend on
    /// which reader a provider happened to call.
    /// </remarks>
    /// <param name="name">Parameter name.</param>
    /// <returns>The parsed value, or <see langword="null"/> when absent.</returns>
    /// <exception cref="ReportParameterException">Present but not a boolean.</exception>
    public bool? GetBool(string name)
    {
        var raw = GetString(name);
        if (raw is null)
        {
            return null;
        }

        return bool.TryParse(raw, out var value)
            ? value
            : throw new ReportParameterException($"Parameter '{name}' must be true or false.");
    }

    /// <summary>Reads a required boolean parameter.</summary>
    /// <param name="name">Parameter name.</param>
    /// <returns>The parsed value.</returns>
    /// <exception cref="ReportParameterException">Missing, or not a boolean.</exception>
    public bool GetRequiredBool(string name) =>
        GetBool(name) ?? throw new ReportParameterException($"Required parameter '{name}' is missing.");
}

/// <summary>One node in a provider's field tree.</summary>
/// <param name="Name">The segment name, as it appears in a dotted path.</param>
/// <param name="Type">One of <c>string</c>, <c>number</c>, <c>date</c>, <c>bool</c>, <c>guid</c>, <c>object</c>, <c>collection</c>.</param>
/// <param name="IsCollection">Collections are bindable by a table's <c>bind</c>; their children describe the row item shape.</param>
/// <param name="Children">Child fields, for object and collection nodes.</param>
public sealed record ReportFieldNode(
    string Name,
    string Type,
    bool IsCollection = false,
    IReadOnlyList<ReportFieldNode>? Children = null)
{
    /// <summary>A leaf field.</summary>
    /// <param name="name">The segment name.</param>
    /// <param name="type">The field type.</param>
    /// <returns>The node.</returns>
    public static ReportFieldNode Scalar(string name, string type = "string") => new(name, type);

    /// <summary>A nested object.</summary>
    /// <param name="name">The segment name.</param>
    /// <param name="children">The object's fields.</param>
    /// <returns>The node.</returns>
    public static ReportFieldNode Object(string name, params ReportFieldNode[] children) =>
        new(name, "object", false, children);

    /// <summary>A repeating collection.</summary>
    /// <param name="name">The segment name.</param>
    /// <param name="children">The row item's fields.</param>
    /// <returns>The node.</returns>
    public static ReportFieldNode Collection(string name, params ReportFieldNode[] children) =>
        new(name, "collection", true, children);

    /// <summary>The dotted paths a <c>visibleIf</c> condition may reference, for this tree.</summary>
    /// <remarks>
    /// Mirrors what the path binder flattens at render time, because that is what builds the
    /// scope: only scalar leaves are addressable, and <b>collections are not traversed at all</b>.
    /// A condition cannot reach inside a collection, so accepting <c>lines.total</c> at authoring
    /// time would just hide the element on every print instead of failing loudly.
    /// This deliberately differs from <see cref="PathExists"/>, which does traverse collections
    /// because a table's <c>bind</c> legitimately targets them.
    /// </remarks>
    /// <param name="root">The provider's field tree root.</param>
    /// <param name="maxDepth">Depth bound, matching the flattener's own.</param>
    /// <returns>Every addressable dotted path.</returns>
    public static IReadOnlySet<string> ConditionPaths(ReportFieldNode root, int maxDepth = 4)
    {
        var paths = new HashSet<string>(StringComparer.Ordinal);
        Collect(root.Children ?? [], prefix: null, depth: 0);
        return paths;

        void Collect(IReadOnlyList<ReportFieldNode> nodes, string? prefix, int depth)
        {
            if (depth > maxDepth)
            {
                return;
            }

            foreach (var node in nodes)
            {
                var path = prefix is null ? node.Name : $"{prefix}.{node.Name}";
                if (node.IsCollection)
                {
                    continue;
                }

                if (node.Children is { Count: > 0 } children)
                {
                    Collect(children, path, depth + 1);
                }
                else
                {
                    paths.Add(path);
                }
            }
        }
    }

    /// <summary>Whether a dotted path resolves inside this tree.</summary>
    /// <remarks>Collections traverse into their item shape, unlike <see cref="ConditionPaths"/>.</remarks>
    /// <param name="roots">The top-level field nodes.</param>
    /// <param name="path">The dotted path to resolve.</param>
    /// <returns><see langword="true"/> when every segment resolves.</returns>
    public static bool PathExists(IReadOnlyList<ReportFieldNode> roots, string path)
    {
        var current = roots;
        ReportFieldNode? node = null;
        foreach (var segment in path.Split('.'))
        {
            node = current.FirstOrDefault(n => n.Name == segment);
            if (node is null)
            {
                return false;
            }

            current = node.Children ?? [];
        }

        return node is not null;
    }
}

/// <summary>Resolves data providers by key.</summary>
public interface IReportDataProviderRegistry
{
    /// <summary>Finds a provider.</summary>
    /// <param name="key">The provider key, matching a definition's <c>dataSource</c>.</param>
    /// <returns>The provider, or <see langword="null"/> when none is registered.</returns>
    IReportDataProvider? Get(string key);

    /// <summary>Every registered provider.</summary>
    /// <returns>The providers.</returns>
    IReadOnlyList<IReportDataProvider> All();
}

/// <summary>Dictionary-backed <see cref="IReportDataProviderRegistry"/>, keyed case-insensitively.</summary>
public sealed class ReportDataProviderRegistry : IReportDataProviderRegistry
{
    private readonly IReadOnlyDictionary<string, IReportDataProvider> _providers;

    /// <summary>Builds the registry.</summary>
    /// <param name="providers">The providers to register. Keys must be unique, case-insensitively.</param>
    public ReportDataProviderRegistry(IEnumerable<IReportDataProvider> providers) =>
        _providers = providers.ToDictionary(p => p.Key, StringComparer.OrdinalIgnoreCase);

    /// <inheritdoc />
    public IReportDataProvider? Get(string key) =>
        _providers.TryGetValue(key, out var provider) ? provider : null;

    /// <inheritdoc />
    public IReadOnlyList<IReportDataProvider> All() => _providers.Values.ToList();
}
