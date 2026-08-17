using System.Text.Json.Nodes;

namespace PlatenReports.Definitions;

/// <summary>
/// Shared loading rules for the file-backed definition sources: parse, validate, and keep the
/// highest version per key.
/// </summary>
/// <remarks>
/// <b>Fail fast.</b> An invalid published definition is a build defect, not a runtime
/// condition — a host should learn about it on startup, not when someone prints a report. Every
/// method here throws rather than skipping the bad document.
/// </remarks>
internal static class DefinitionLoader
{
    /// <summary>Parses one document and turns it into a <see cref="ReportDefinition"/>.</summary>
    /// <param name="json">The document text.</param>
    /// <param name="origin">Where it came from, for error messages.</param>
    /// <returns>The parsed definition and its comparable version.</returns>
    /// <exception cref="InvalidOperationException">The version is not parseable as a <see cref="Version"/>.</exception>
    /// <exception cref="Model.ReportValidationException">The document is structurally invalid.</exception>
    internal static (Version Version, ReportDefinition Definition) Load(string json, string origin)
    {
        var model = ReportDefinitionParser.Parse(json);
        var document = (JsonObject)JsonNode.Parse(json)!;

        if (!Version.TryParse(model.Version, out var version))
        {
            throw new InvalidOperationException(
                $"Report definition '{origin}' has a non-parseable version '{model.Version}'.");
        }

        return (version, new ReportDefinition(
            model.Key, model.Version, model.DataSource, model.RequiredPermission, document));
    }

    /// <summary>Reduces a set of documents to the highest version per key.</summary>
    /// <param name="documents">Document text paired with an origin for error messages.</param>
    /// <returns>One definition per key, keyed case-insensitively.</returns>
    internal static IReadOnlyDictionary<string, ReportDefinition> HighestVersionPerKey(
        IEnumerable<(string Json, string Origin)> documents)
    {
        var byKey = new Dictionary<string, (Version Version, ReportDefinition Definition)>(
            StringComparer.OrdinalIgnoreCase);

        foreach (var (json, origin) in documents)
        {
            var (version, candidate) = Load(json, origin);
            if (!byKey.TryGetValue(candidate.Key, out var existing) || version > existing.Version)
            {
                byKey[candidate.Key] = (version, candidate);
            }
        }

        return byKey.ToDictionary(kv => kv.Key, kv => kv.Value.Definition, StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>The list shape <see cref="IReportDefinitionSource.ListReports"/> promises.</summary>
    /// <param name="byKey">The resolved definitions.</param>
    /// <returns>The definitions ordered by key.</returns>
    internal static IReadOnlyList<ReportDefinition> Ordered(IReadOnlyDictionary<string, ReportDefinition> byKey) =>
        byKey.Values.OrderBy(d => d.Key, StringComparer.Ordinal).ToList();
}
