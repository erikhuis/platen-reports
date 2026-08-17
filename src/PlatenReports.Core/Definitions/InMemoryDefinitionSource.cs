namespace PlatenReports.Definitions;

/// <summary>Definitions supplied as JSON strings.</summary>
/// <remarks>
/// For tests, and for a host that builds or fetches definition JSON itself. Documents are
/// parsed and validated eagerly, in the constructor — a bad document fails where it was
/// supplied rather than on first render.
/// </remarks>
public sealed class InMemoryDefinitionSource : IReportDefinitionSource
{
    private readonly IReadOnlyDictionary<string, ReportDefinition> _definitions;

    /// <summary>Creates the source.</summary>
    /// <param name="jsonDocuments">The definition documents. Highest version per key wins.</param>
    public InMemoryDefinitionSource(params string[] jsonDocuments)
        : this((IEnumerable<string>)jsonDocuments)
    {
    }

    /// <summary>Creates the source.</summary>
    /// <param name="jsonDocuments">The definition documents. Highest version per key wins.</param>
    public InMemoryDefinitionSource(IEnumerable<string> jsonDocuments)
    {
        ArgumentNullException.ThrowIfNull(jsonDocuments);

        _definitions = DefinitionLoader.HighestVersionPerKey(
            jsonDocuments.Select((json, index) => (json, $"in-memory document {index}")));
    }

    /// <inheritdoc />
    public IReadOnlyList<ReportDefinition> ListReports() => DefinitionLoader.Ordered(_definitions);

    /// <inheritdoc />
    public ReportDefinition? Get(string key) =>
        _definitions.TryGetValue(key, out var definition) ? definition : null;
}
