using System.Text.Json.Nodes;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using PlatenReports.Model;
using Xunit;

namespace PlatenReports.Core.Tests;

/// <summary>
/// Issue #2164 — the structural-authoring preview: <see cref="ReportingService.RenderAsync"/>
/// renders a DRAFT standard definition passed in the request instead of the stored one, so the
/// designer can preview un-committed structural edits. Bad drafts surface as the validation
/// contract, never a 500, and never a silent fallback to the shipped standard.
/// </summary>
public class ReportingServiceDraftDefinitionTests
{
    // The stored standard body has a single text "stored"; the draft swaps it for "drafted".
    private const string StoredJson = """
    { "schemaVersion": 1, "key": "test-report", "version": "1.0.0", "title": "Test",
      "dataSource": "test-source", "body": [ { "id": "a", "type": "text", "text": "stored" } ] }
    """;
    private const string DraftJson = """
    { "schemaVersion": 1, "key": "test-report", "version": "2.0.0", "title": "Draft",
      "dataSource": "test-source", "body": [ { "id": "a", "type": "text", "text": "drafted" } ] }
    """;

    [Fact]
    public async Task RenderAsync_renders_the_draft_definition_not_the_stored_one()
    {
        var renderer = new CapturingRenderer();
        var service = BuildService(renderer);

        await service.RenderAsync("test-report", new Dictionary<string, string>(), "en",
            draftDefinitionJson: DraftJson);

        // The parsed model handed to the renderer is the DRAFT's title, not the stored one.
        renderer.LastModel!.Title.Resolve("en").Should().Be("Draft");
    }

    [Fact]
    public async Task RenderAsync_draft_definition_ignores_the_stored_overlay()
    {
        // Even if the tenant had an enabled overlay, the draft path bypasses the merge entirely.
        var renderer = new CapturingRenderer();
        var service = BuildService(renderer, overlay: new FakeOverlayStore(hasEnabledOverlay: true));

        var act = async () => await service.RenderAsync("test-report", new Dictionary<string, string>(), "en",
            draftDefinitionJson: DraftJson);

        await act.Should().NotThrowAsync();
        renderer.LastModel!.Title.Resolve("en").Should().Be("Draft");
    }

    [Fact]
    public async Task RenderAsync_draft_definition_surfaces_parse_errors_as_validation()
    {
        var service = BuildService(new CapturingRenderer());

        // A text element with no text is a fatal parser rule → ReportValidationException (400),
        // not a 500 and not a silent standard fallback.
        var badDraft = """
        { "schemaVersion": 1, "key": "test-report", "version": "1.0.0", "title": "Bad",
          "dataSource": "test-source", "body": [ { "id": "a", "type": "text" } ] }
        """;
        var act = async () => await service.RenderAsync("test-report", new Dictionary<string, string>(), "en",
            draftDefinitionJson: badDraft);

        await act.Should().ThrowAsync<ReportValidationException>();
    }

    [Fact]
    public async Task RenderAsync_draft_definition_surfaces_malformed_json_as_validation()
    {
        var service = BuildService(new CapturingRenderer());

        var act = async () => await service.RenderAsync("test-report", new Dictionary<string, string>(), "en",
            draftDefinitionJson: "{ not json");

        await act.Should().ThrowAsync<ReportValidationException>();
    }

    [Fact]
    public async Task RenderAsync_draft_definition_rejects_a_mismatched_data_source()
    {
        // SECURITY: the caller is authorized against the STORED report's requiredPermission. A draft
        // whose dataSource differs would render a provider the caller was never checked for, so it is
        // rejected as a validation error (not silently rendered against the other provider).
        var renderer = new CapturingRenderer();
        var service = BuildService(renderer, providers:
            new ReportDataProviderRegistry([new FakeDataProvider(), new OtherDataProvider()]));

        var crossSourceDraft = """
        { "schemaVersion": 1, "key": "test-report", "version": "2.0.0", "title": "Draft",
          "dataSource": "other-source", "body": [ { "id": "a", "type": "text", "text": "x" } ] }
        """;
        var act = async () => await service.RenderAsync("test-report", new Dictionary<string, string>(), "en",
            draftDefinitionJson: crossSourceDraft);

        await act.Should().ThrowAsync<ReportValidationException>();
        renderer.LastModel.Should().BeNull("the mismatched draft must never reach the renderer");
    }

    private static ReportingService BuildService(
        CapturingRenderer renderer, FakeOverlayStore? overlay = null, ReportDataProviderRegistry? providers = null) =>
        new(
            new FakeDefinitionStore(),
            overlay ?? new FakeOverlayStore(),
            providers ?? new ReportDataProviderRegistry([new FakeDataProvider()]),
            renderer,
            new ReportingTestHost.PermissiveConditions(),
            new StubAssetProvider(),
            NullLogger<ReportingService>.Instance);

    private sealed class FakeDefinitionStore : IReportDefinitionSource
    {
        private readonly ReportDefinition _definition = new(
            "test-report", "1.0.0", "test-source", null, (JsonObject)JsonNode.Parse(StoredJson)!);
        public IReadOnlyList<ReportDefinition> ListReports() => [_definition];
        public ReportDefinition? Get(string key) => key == "test-report" ? _definition : null;
    }

    private sealed class FakeOverlayStore(bool hasEnabledOverlay = false) : IReportOverlayStore
    {
        public Task<ReportOverlayRecord?> GetAsync(string reportKey, CancellationToken ct = default) =>
            Task.FromResult(hasEnabledOverlay
                ? new ReportOverlayRecord(reportKey, """{ "suppress": ["a"] }""", "1.0.0", true, DateTime.UtcNow)
                : null);
        public Task<IReadOnlyList<ReportOverlayRecord>> GetAllAsync(CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<ReportOverlayRecord>>([]);
        public Task<ReportOverlayRecord> UpsertAsync(string reportKey, string overlayJson, string? baseVersion,
            bool isEnabled, CancellationToken ct = default) =>
            Task.FromResult(new ReportOverlayRecord(reportKey, overlayJson, baseVersion, isEnabled, DateTime.UtcNow));
        public Task<bool> DeleteAsync(string reportKey, CancellationToken ct = default) => Task.FromResult(false);
    }

    private sealed class FakeDataProvider : IReportDataProvider
    {
        public string Key => "test-source";
        public IReadOnlyList<ReportParameterDefinition> Parameters => [];
        public ReportFieldNode DescribeFields() => ReportFieldNode.Object("root");
        public Task<ReportDataContext> LoadAsync(ReportParameters parameters, CancellationToken ct) =>
            Task.FromResult(ReportDataContext.Empty);
    }

    private sealed class OtherDataProvider : IReportDataProvider
    {
        public string Key => "other-source";
        public IReadOnlyList<ReportParameterDefinition> Parameters => [];
        public ReportFieldNode DescribeFields() => ReportFieldNode.Object("root");
        public Task<ReportDataContext> LoadAsync(ReportParameters parameters, CancellationToken ct) =>
            Task.FromResult(ReportDataContext.Empty);
    }

    private sealed class CapturingRenderer : IReportRenderer
    {
        public ReportDocumentModel? LastModel { get; private set; }
        public string ContentType => "application/pdf";
        public string FileExtension => "pdf";

        public byte[] Render(ReportDocumentModel document, ReportRenderContext context)
        {
            LastModel = document;
            return [0x25, 0x50, 0x44, 0x46];
        }
    }

    private sealed class StubAssetProvider : IReportAssetProvider
    {
        public ValueTask<ReportAsset?> GetAsync(string source, CancellationToken ct = default) =>
            ValueTask.FromResult<ReportAsset?>(null);
    }
}
