namespace PlatenReports.Definitions;

/// <summary>Layers several sources into one, earlier sources winning.</summary>
/// <remarks>
/// <para>The point is overriding: put a <see cref="DirectoryDefinitionSource"/> ahead of an
/// <see cref="EmbeddedResourceDefinitionSource"/> and a file on disk shadows the published
/// definition of the same key, which is how a host offers per-deployment overrides without
/// rebuilding.</para>
/// <para><b>First match wins, not highest version.</b> Within a single source the highest
/// version wins, but across sources precedence is positional — otherwise an override could not
/// deliberately pin an older revision.</para>
/// </remarks>
public sealed class CompositeDefinitionSource : IReportDefinitionSource
{
    private readonly IReadOnlyList<IReportDefinitionSource> _sources;

    /// <summary>Creates the composite.</summary>
    /// <param name="sources">The sources, highest precedence first.</param>
    public CompositeDefinitionSource(params IReportDefinitionSource[] sources)
        : this((IEnumerable<IReportDefinitionSource>)sources)
    {
    }

    /// <summary>Creates the composite.</summary>
    /// <param name="sources">The sources, highest precedence first.</param>
    public CompositeDefinitionSource(IEnumerable<IReportDefinitionSource> sources)
    {
        ArgumentNullException.ThrowIfNull(sources);
        _sources = sources.ToList();
    }

    /// <inheritdoc />
    public IReadOnlyList<ReportDefinition> ListReports()
    {
        var byKey = new Dictionary<string, ReportDefinition>(StringComparer.OrdinalIgnoreCase);

        foreach (var source in _sources)
        {
            foreach (var definition in source.ListReports())
            {
                // First source to claim a key keeps it.
                _ = byKey.TryAdd(definition.Key, definition);
            }
        }

        return byKey.Values.OrderBy(d => d.Key, StringComparer.Ordinal).ToList();
    }

    /// <inheritdoc />
    public ReportDefinition? Get(string key)
    {
        foreach (var source in _sources)
        {
            var definition = source.Get(key);
            if (definition is not null)
            {
                return definition;
            }
        }

        return null;
    }
}
