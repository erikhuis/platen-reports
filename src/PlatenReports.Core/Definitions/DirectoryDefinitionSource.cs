namespace PlatenReports.Definitions;

/// <summary>Loads definitions from <c>*.json</c> files in a directory.</summary>
/// <remarks>
/// Useful for a host that wants definitions editable without a redeploy, and for the sample
/// host. Like the embedded source, the highest version per key wins and documents are read once
/// on first use — this does <b>not</b> watch the directory for changes.
/// </remarks>
public sealed class DirectoryDefinitionSource : IReportDefinitionSource
{
    private readonly Lazy<IReadOnlyDictionary<string, ReportDefinition>> _definitions;

    /// <summary>Creates the source.</summary>
    /// <param name="path">Directory to scan. Not searched recursively.</param>
    /// <param name="searchPattern">File pattern; defaults to <c>*.json</c>.</param>
    public DirectoryDefinitionSource(string path, string searchPattern = "*.json")
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        ArgumentException.ThrowIfNullOrWhiteSpace(searchPattern);

        _definitions = new Lazy<IReadOnlyDictionary<string, ReportDefinition>>(
            () => Load(path, searchPattern), LazyThreadSafetyMode.ExecutionAndPublication);
    }

    /// <inheritdoc />
    public IReadOnlyList<ReportDefinition> ListReports() => DefinitionLoader.Ordered(_definitions.Value);

    /// <inheritdoc />
    public ReportDefinition? Get(string key) =>
        _definitions.Value.TryGetValue(key, out var definition) ? definition : null;

    private static IReadOnlyDictionary<string, ReportDefinition> Load(string path, string searchPattern)
    {
        if (!Directory.Exists(path))
        {
            throw new DirectoryNotFoundException($"Report definition directory '{path}' does not exist.");
        }

        var documents = Directory.EnumerateFiles(path, searchPattern)
            .OrderBy(f => f, StringComparer.Ordinal)
            .Select(file => (Json: File.ReadAllText(file), Origin: file));

        return DefinitionLoader.HighestVersionPerKey(documents);
    }
}
