using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging.Abstractions;
using PlatenReports.Model;

namespace PlatenReports.Core.Tests;

/// <summary>
/// Assembles a <see cref="ReportingService"/> over stub collaborators so a test only has to name
/// the one it cares about.
///
/// The condition evaluator is injectable and defaults to <see cref="PermissiveConditions"/>: the
/// real NCalc implementation ships in PlatenReports.NCalc, which Core must not depend on. Tests
/// that assert on condition *validation* therefore live with that package, not here.
/// </summary>
internal static class ReportingTestHost
{
    internal const string DefinitionJson = """
    {
      "schemaVersion": 1, "key": "test-report", "version": "1.0.0",
      "title": "Test", "dataSource": "test-source",
      "body": [ { "id": "a", "type": "text", "text": "content" } ]
    }
    """;

    internal static ReportingService Build(
        IReportRenderer renderer,
        ReportingOptions? options = null,
        TimeProvider? clock = null,
        string? definitionJson = null,
        IReportConditionEvaluator? conditions = null,
        IReportAssetProvider? assets = null) =>
        new(
            new StubDefinitionSource(definitionJson ?? DefinitionJson),
            new StubOverlayStore(),
            new ReportDataProviderRegistry([new StubDataProvider()]),
            renderer,
            conditions ?? new PermissiveConditions(),
            assets ?? new StubAssetProvider(),
            NullLogger<ReportingService>.Instance,
            options,
            clock);

    private sealed class StubDefinitionSource(string definitionJson) : IReportDefinitionSource
    {
        private readonly ReportDefinition _definition = new(
            "test-report", "1.0.0", "test-source", null, (JsonObject)JsonNode.Parse(definitionJson)!);

        public IReadOnlyList<ReportDefinition> ListReports() => [_definition];
        public ReportDefinition? Get(string key) => key == "test-report" ? _definition : null;
    }

    private sealed class StubOverlayStore : IReportOverlayStore
    {
        public Task<ReportOverlayRecord?> GetAsync(string reportKey, CancellationToken ct = default) =>
            Task.FromResult<ReportOverlayRecord?>(null);
        public Task<IReadOnlyList<ReportOverlayRecord>> GetAllAsync(CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<ReportOverlayRecord>>([]);
        public Task<ReportOverlayRecord> UpsertAsync(string reportKey, string overlayJson, string? baseVersion,
            bool isEnabled, CancellationToken ct = default) =>
            Task.FromResult(new ReportOverlayRecord(reportKey, overlayJson, baseVersion, isEnabled, DateTime.UtcNow));
        public Task<bool> DeleteAsync(string reportKey, CancellationToken ct = default) => Task.FromResult(false);
    }

    private sealed class StubDataProvider : IReportDataProvider
    {
        public string Key => "test-source";
        public IReadOnlyList<ReportParameterDefinition> Parameters => [];
        public ReportFieldNode DescribeFields() => ReportFieldNode.Object("$root");
        public Task<ReportDataContext> LoadAsync(ReportParameters parameters, CancellationToken ct) =>
            Task.FromResult(ReportDataContext.Empty);
    }

    /// <summary>
    /// Everything visible, everything valid. Enough for the orchestration paths; the real
    /// evaluator's behaviour is PlatenReports.NCalc's to prove.
    /// </summary>
    internal sealed class PermissiveConditions : IReportConditionEvaluator
    {
        public ConditionResult Evaluate(string expression, IReadOnlyDictionary<string, object?> scope) =>
            ConditionResult.Shown;

        public IReadOnlyList<string> Validate(string expression, IReadOnlySet<string>? knownPaths = null) => [];
    }

    private sealed class StubAssetProvider : IReportAssetProvider
    {
        public ValueTask<ReportAsset?> GetAsync(string source, CancellationToken ct = default) =>
            ValueTask.FromResult<ReportAsset?>(null);
    }
}

/// <summary>
/// Minimal <see cref="TimeProvider"/> stub — the repo has no TimeProvider.Testing package, and a
/// single override does not justify adding one. Mirrors the existing <c>FixedClock</c> habit.
/// </summary>
internal sealed class FixedTimeProvider(DateTime utcNow) : TimeProvider
{
    public override DateTimeOffset GetUtcNow() => new(utcNow, TimeSpan.Zero);
}

/// <summary>Captures what the orchestrator handed the renderer.</summary>
internal sealed class SpyRenderer(string contentType = "application/pdf", string fileExtension = "pdf")
    : IReportRenderer
{
    public ReportRenderContext? LastContext { get; private set; }
    public ReportDocumentModel? LastModel { get; private set; }

    public string ContentType => contentType;
    public string FileExtension => fileExtension;

    public byte[] Render(ReportDocumentModel document, ReportRenderContext context)
    {
        LastModel = document;
        LastContext = context;
        return [0x25, 0x50, 0x44, 0x46]; // %PDF
    }
}
