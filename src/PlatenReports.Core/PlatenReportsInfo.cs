namespace PlatenReports;

/// <summary>
/// Static facts about this build of the engine.
/// </summary>
/// <remarks>
/// The engine is being extracted in phases; this type is the seed of the public
/// surface, not the whole of it.
/// </remarks>
public static class PlatenReportsInfo
{
    /// <summary>
    /// The report-definition <c>schemaVersion</c> values this engine can load.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This is deliberately a <em>set</em> rather than a single supported value.
    /// An engine must be able to accept a range and lift older definitions to
    /// the current shape in memory — see <c>docs/schema-version.md</c>.
    /// </para>
    /// <para>
    /// The origin codebase compared a <c>const int</c> with <c>!=</c>, which
    /// makes a range unrepresentable and turns every format bump into a hard
    /// break for stored definitions. Do not reintroduce that shape.
    /// </para>
    /// </remarks>
    public static IReadOnlySet<int> SupportedSchemaVersions { get; } =
        new HashSet<int> { 1 };

    /// <summary>
    /// Whether this engine can load a definition declaring the given
    /// <paramref name="schemaVersion"/>.
    /// </summary>
    /// <param name="schemaVersion">The definition's declared schema version.</param>
    /// <returns><see langword="true"/> if the version is supported.</returns>
    public static bool SupportsSchemaVersion(int schemaVersion) =>
        SupportedSchemaVersions.Contains(schemaVersion);
}
