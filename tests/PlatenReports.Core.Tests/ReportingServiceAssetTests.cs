using FluentAssertions;
using Xunit;

namespace PlatenReports.Core.Tests;

/// <summary>
/// Asset resolution, as the orchestrator does it: walk the document, ask the provider once per
/// distinct source, and hand the renderer only what it can actually draw.
/// </summary>
/// <remarks>
/// The origin suite composed the host's own tenant-logo adapter over a fake tenant context. Two
/// of its behaviours belong to that adapter and stayed with it — "no tenant, no lookup" is not
/// something the engine can have an opinion about, because the engine has no tenants. What is
/// asserted here is the part the engine owns, and it is the part that regressed once before: a
/// resolved asset must actually reach the renderer.
/// </remarks>
public class ReportingServiceAssetTests
{
    private static readonly byte[] LogoBytes = [1, 2, 3, 4];

    [Fact]
    public async Task RenderAsync_passes_a_resolved_asset_to_the_renderer()
    {
        var renderer = new SpyRenderer();
        var service = Build(renderer, new CountingAssetProvider(LogoBytes), ImageInHeaderJson);

        await service.RenderAsync("test-report", new Dictionary<string, string>(), "en");

        renderer.LastContext!.Assets.Should().ContainKey("tenantLogo");
        renderer.LastContext.Assets["tenantLogo"].Content.Should().Equal(LogoBytes);
    }

    [Fact]
    public async Task RenderAsync_passes_no_asset_when_the_provider_has_none()
    {
        var renderer = new SpyRenderer();
        var service = Build(renderer, new CountingAssetProvider(null), ImageInHeaderJson);

        await service.RenderAsync("test-report", new Dictionary<string, string>(), "en");

        renderer.LastContext!.Assets.Should().BeEmpty();
    }

    [Fact]
    public async Task RenderAsync_treats_empty_content_as_nothing_to_draw()
    {
        // An empty byte[] is not a drawable image. The port documents that a provider with
        // nothing to give returns null, but the engine does not take that on trust.
        var renderer = new SpyRenderer();
        var service = Build(renderer, new CountingAssetProvider([]), ImageInHeaderJson);

        await service.RenderAsync("test-report", new Dictionary<string, string>(), "en");

        renderer.LastContext!.Assets.Should().BeEmpty();
    }

    [Fact]
    public async Task RenderAsync_resolves_a_source_referenced_twice_only_once()
    {
        // A definition puts the logo in the header; an overlay can add one to the footer too.
        // Resolving per element would double a fetch the host may not have cached.
        var renderer = new SpyRenderer();
        var provider = new CountingAssetProvider(LogoBytes);
        var service = Build(renderer, provider, ImageInHeaderAndFooterJson);

        await service.RenderAsync("test-report", new Dictionary<string, string>(), "en");

        provider.CallCount.Should().Be(1, "each distinct image source is resolved at most once per render");
        renderer.LastContext!.Assets.Should().ContainKey("tenantLogo");
    }

    [Fact]
    public async Task RenderAsync_resolves_nothing_when_the_document_has_no_image()
    {
        // The document decides whether a fetch happens at all.
        var renderer = new SpyRenderer();
        var provider = new CountingAssetProvider(LogoBytes);
        var service = Build(renderer, provider, NoImageJson);

        await service.RenderAsync("test-report", new Dictionary<string, string>(), "en");

        provider.CallCount.Should().Be(0);
        renderer.LastContext!.Assets.Should().BeEmpty();
    }

    private static ReportingService Build(
        IReportRenderer renderer, IReportAssetProvider assets, string definitionJson) =>
        ReportingTestHost.Build(renderer, definitionJson: definitionJson, assets: assets);

    private const string ImageInHeaderJson = """
    {
      "schemaVersion": 1, "key": "test-report", "version": "1.0.0",
      "title": "Test", "dataSource": "test-source",
      "pageHeader": { "id": "hdr", "type": "image", "source": "tenantLogo", "height": 30 },
      "body": [ { "id": "a", "type": "text", "text": "content" } ]
    }
    """;

    private const string ImageInHeaderAndFooterJson = """
    {
      "schemaVersion": 1, "key": "test-report", "version": "1.0.0",
      "title": "Test", "dataSource": "test-source",
      "pageHeader": { "id": "hdr", "type": "image", "source": "tenantLogo", "height": 30 },
      "pageFooter": { "id": "ftr", "type": "image", "source": "tenantLogo", "height": 20 },
      "body": [ { "id": "a", "type": "text", "text": "content" } ]
    }
    """;

    private const string NoImageJson = """
    {
      "schemaVersion": 1, "key": "test-report", "version": "1.0.0",
      "title": "Test", "dataSource": "test-source",
      "body": [ { "id": "a", "type": "text", "text": "content" } ]
    }
    """;

    /// <summary>Serves one set of bytes and counts how often it was asked.</summary>
    private sealed class CountingAssetProvider(byte[]? content) : IReportAssetProvider
    {
        public int CallCount { get; private set; }

        public ValueTask<ReportAsset?> GetAsync(string source, CancellationToken ct = default)
        {
            CallCount++;
            return ValueTask.FromResult(content is null ? null : new ReportAsset(content, "image/png"));
        }
    }
}
