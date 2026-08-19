using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Xunit;
using static PlatenReports.AspNetCore.Tests.ReportingTestHost;

namespace PlatenReports.AspNetCore.Tests;

/// <summary>
/// Pins the JSON property names the designer reads.
/// </summary>
/// <remarks>
/// These break the frontend at runtime, not at build: a renamed or re-cased property compiles
/// cleanly on both sides and shows up as an undefined field in a browser. Asserted against the
/// wire, through the real serializer the pipeline uses, rather than against the record shapes —
/// a serializer option is exactly the kind of thing that changes this without touching a record.
/// </remarks>
public class WireContractTests
{
    private static async Task<JsonElement> GetJson(HttpClient client, string url)
    {
        var response = await client.GetAsync(url);
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
    }

    [Fact]
    public async Task Catalogue_item_property_names()
    {
        var json = await GetJson(Build(new SpyReportingService(), new StubAuthorizer()), "/api/v1/reports");
        var item = json[0];

        foreach (string? name in new[]
        {
            "key", "title", "version", "dataSource", "requiredPermission",
            "hasOverlay", "overlayEnabled", "parameters",
        })
        {
            item.TryGetProperty(name, out _).Should().BeTrue($"the designer reads '{name}'");
        }

        var parameter = item.GetProperty("parameters")[0];
        parameter.TryGetProperty("name", out _).Should().BeTrue();
        parameter.TryGetProperty("type", out _).Should().BeTrue();
        parameter.TryGetProperty("required", out _).Should().BeTrue();
    }

    [Fact]
    public async Task Effective_definition_property_names()
    {
        var json = await GetJson(
            Build(new SpyReportingService(), new StubAuthorizer()), "/api/v1/reports/wo/definition");

        json.TryGetProperty("definitionJson", out _).Should().BeTrue();
        json.TryGetProperty("standardVersion", out _).Should().BeTrue();
        json.TryGetProperty("warnings", out _).Should().BeTrue();
    }

    [Fact]
    public async Task Overlay_property_names()
    {
        var json = await GetJson(
            Build(new SpyReportingService(), new StubAuthorizer()), "/api/v1/reports/wo/overlay");

        foreach (string? name in new[] { "reportKey", "overlayJson", "baseVersion", "isEnabled", "updatedAt" })
        {
            json.TryGetProperty(name, out _).Should().BeTrue($"the designer reads '{name}'");
        }
    }

    [Fact]
    public async Task Field_node_property_names()
    {
        var json = await GetJson(
            Build(new SpyReportingService(), new StubAuthorizer()), "/api/v1/reports/wo/fields");

        foreach (string? name in new[] { "name", "type", "isCollection", "children" })
        {
            json.TryGetProperty(name, out _).Should().BeTrue($"the designer reads '{name}'");
        }
    }

    [Fact]
    public async Task Validation_result_property_names()
    {
        var client = Build(new SpyReportingService(), new StubAuthorizer());

        var response = await client.PutAsJsonAsync(
            "/api/v1/reports/wo/overlay", new PutOverlayRequest("{}", true));
        var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

        foreach (string? name in new[] { "valid", "errors", "warnings" })
        {
            json.TryGetProperty(name, out _).Should().BeTrue($"the designer reads '{name}'");
        }
    }

    [Fact]
    public async Task A_rejected_overlay_answers_with_the_validation_shape_not_a_bare_error()
    {
        // The editor renders these against the elements that produced them, so a 400 carrying
        // { error: "..." } instead of { valid, errors, warnings } would surface as nothing at all.
        var client = Build(new SpyReportingService(), new StubAuthorizer());

        var response = await client.PutAsJsonAsync(
            "/api/v1/reports/wo/overlay", new PutOverlayRequest("bad", true));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
        json.GetProperty("valid").GetBoolean().Should().BeFalse();
        json.GetProperty("errors").EnumerateArray().Should().ContainSingle();
    }

    [Fact]
    public async Task Request_bodies_bind_from_camelCase()
    {
        // The other direction, and just as breakable: the designer sends camelCase.
        var service = new SpyReportingService();
        var client = Build(service, new StubAuthorizer());

        var response = await client.PostAsync("/api/v1/reports/wo/preview",
            JsonContent.Create(JsonDocument.Parse(
                """{"overlayJson":"{}","parameters":{"id":"1"},"locale":"nl","timeZone":"Europe/Amsterdam"}""")
                .RootElement));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        service.LastLocale.Should().Be("nl", "the locale came off the wire, not the default");
        service.LastParameters.Should().ContainKey("id");
    }
}
