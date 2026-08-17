using System.Reflection;

namespace PlatenReports.Definitions;

/// <summary>
/// Loads definitions from JSON files embedded in an assembly the host names.
/// </summary>
/// <remarks>
/// <para>The usual shipping model: <c>&lt;key&gt;.&lt;version&gt;.json</c> as embedded resources,
/// so a deploy updates every caller at once with nothing to migrate. The highest version per key
/// wins, so publishing a new revision is adding the file — the old one can stay.</para>
/// <para>The assembly and resource prefix are <b>constructor arguments</b>, not constants. A
/// package cannot know where its host keeps its definitions, and hardcoding either would make
/// this class useful to exactly one application.</para>
/// <para>Documents are read, parsed and validated once, on <b>first use</b> — not at
/// construction. An invalid embedded definition therefore throws from <see cref="ListReports"/>
/// or <see cref="Get"/>. Since these ship inside the assembly, calling <see cref="ListReports"/>
/// once at startup turns a latent build defect into a boot failure, which is where it belongs.</para>
/// </remarks>
public sealed class EmbeddedResourceDefinitionSource : IReportDefinitionSource
{
    private readonly Lazy<IReadOnlyDictionary<string, ReportDefinition>> _definitions;

    /// <summary>Creates the source.</summary>
    /// <param name="assembly">The assembly holding the embedded definitions.</param>
    /// <param name="resourcePrefix">
    /// Resource-name prefix to scan, e.g. <c>"MyApp.Reports.Definitions."</c>. Include the
    /// trailing dot; resource names are the manifest names, not file paths.
    /// </param>
    public EmbeddedResourceDefinitionSource(Assembly assembly, string resourcePrefix)
    {
        ArgumentNullException.ThrowIfNull(assembly);
        ArgumentException.ThrowIfNullOrWhiteSpace(resourcePrefix);

        _definitions = new Lazy<IReadOnlyDictionary<string, ReportDefinition>>(
            () => Load(assembly, resourcePrefix), LazyThreadSafetyMode.ExecutionAndPublication);
    }

    /// <inheritdoc />
    public IReadOnlyList<ReportDefinition> ListReports() => DefinitionLoader.Ordered(_definitions.Value);

    /// <inheritdoc />
    public ReportDefinition? Get(string key) =>
        _definitions.Value.TryGetValue(key, out var definition) ? definition : null;

    private static IReadOnlyDictionary<string, ReportDefinition> Load(Assembly assembly, string prefix)
    {
        var documents = new List<(string Json, string Origin)>();

        foreach (var resourceName in assembly.GetManifestResourceNames()
                     .Where(n => n.StartsWith(prefix, StringComparison.Ordinal)
                                 && n.EndsWith(".json", StringComparison.Ordinal)))
        {
            using var stream = assembly.GetManifestResourceStream(resourceName)
                ?? throw new InvalidOperationException(
                    $"Embedded report definition '{resourceName}' could not be opened.");
            using var reader = new StreamReader(stream);
            documents.Add((reader.ReadToEnd(), resourceName));
        }

        return DefinitionLoader.HighestVersionPerKey(documents);
    }
}
