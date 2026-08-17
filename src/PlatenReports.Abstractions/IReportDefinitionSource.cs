using System.Text.Json.Nodes;

namespace PlatenReports;

/// <summary>One report definition, parsed and validated, as the engine sees it.</summary>
/// <param name="Key">Stable report identifier, from the document's <c>key</c>.</param>
/// <param name="Version">The document's own version. Must be parseable as a <see cref="System.Version"/>.</param>
/// <param name="DataSource">Names the data provider that supplies this report's data.</param>
/// <param name="RequiredPermission">The permission the document declares, when it declares one.</param>
/// <param name="Document">
/// The raw JSON document. Treated as immutable — take <see cref="CloneDocument"/> before
/// mutating, because a source is free to hand the same instance to every caller.
/// </param>
public sealed record ReportDefinition(
    string Key,
    string Version,
    string DataSource,
    string? RequiredPermission,
    JsonObject Document)
{
    /// <summary>A deep clone, safe to mutate — as overlay merging does.</summary>
    /// <returns>An independent copy of <see cref="Document"/>.</returns>
    public JsonObject CloneDocument() => (JsonObject)Document.DeepClone();
}

/// <summary>Where the engine finds the report definitions a host publishes.</summary>
/// <remarks>
/// <para>Definitions are *published artefacts*, not user data: they ship with the host and a
/// deploy updates them for everyone at once. Element ids inside a published definition are a
/// public contract, because customisation overlays address them — renaming one breaks every
/// overlay that patched it.</para>
/// <para>The engine never assumes where they live. <c>PlatenReports.Core</c> ships sources for
/// embedded resources, a directory and an in-memory list, plus a composite that layers them;
/// a host with definitions in a database implements this interface instead.</para>
/// </remarks>
public interface IReportDefinitionSource
{
    /// <summary>Every definition this source publishes, ordered by key.</summary>
    /// <returns>The definitions.</returns>
    IReadOnlyList<ReportDefinition> ListReports();

    /// <summary>Finds one definition by key.</summary>
    /// <param name="key">The report key. Matching is case-insensitive.</param>
    /// <returns>The definition, or <see langword="null"/> when this source has no such report.</returns>
    ReportDefinition? Get(string key);
}
