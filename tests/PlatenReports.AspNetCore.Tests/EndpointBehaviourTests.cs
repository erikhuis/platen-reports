using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Xunit;
using static PlatenReports.AspNetCore.Tests.ReportingTestHost;

namespace PlatenReports.AspNetCore.Tests;

/// <summary>Status codes, headers and parameter collection — the HTTP half of the contract.</summary>
public class EndpointBehaviourTests
{
    [Theory]
    [InlineData("/api/v1/reports/missing/definition")]
    [InlineData("/api/v1/reports/missing/definition/standard")]
    [InlineData("/api/v1/reports/missing/fields")]
    [InlineData("/api/v1/reports/missing/overlay")]
    public async Task An_unknown_report_is_404(string url)
    {
        var response = await Build(new SpyReportingService(), new StubAuthorizer()).GetAsync(url);
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task The_standard_definition_is_served_as_raw_json()
    {
        // Results.Ok would serialize the string, wrapping the whole document in quotes and
        // escaping every brace — valid JSON, and useless to a caller expecting a document.
        var response = await Build(new SpyReportingService(), new StubAuthorizer())
            .GetAsync("/api/v1/reports/wo/definition/standard");

        response.Content.Headers.ContentType!.MediaType.Should().Be("application/json");
        (await response.Content.ReadAsStringAsync()).Should().Be("""{"key":"wo"}""");
    }

    [Fact]
    public async Task An_empty_overlay_body_is_400_not_a_delete()
    {
        var response = await Build(new SpyReportingService(), new StubAuthorizer())
            .PutAsJsonAsync("/api/v1/reports/wo/overlay", new PutOverlayRequest("   ", true));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Deleting_a_missing_overlay_is_404_and_deleting_one_is_204()
    {
        var client = Build(new SpyReportingService(), new StubAuthorizer());

        (await client.DeleteAsync("/api/v1/reports/missing/overlay")).StatusCode
            .Should().Be(HttpStatusCode.NotFound);
        (await client.DeleteAsync("/api/v1/reports/wo/overlay")).StatusCode
            .Should().Be(HttpStatusCode.NoContent);
    }

    [Fact]
    public async Task Render_serves_the_pdf_inline_with_an_encoded_filename()
    {
        // Attachment turns a print tab into a download and leaves the tab blank. The filename
        // carries non-ASCII on purpose: it must survive as RFC 5987 rather than being mangled.
        var response = await Build(new SpyReportingService(), new StubAuthorizer())
            .GetAsync("/api/v1/reports/wo/render");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var disposition = response.Content.Headers.ContentDisposition!;
        disposition.DispositionType.Should().Be("inline");
        disposition.FileNameStar.Should().Contain("nïcode", "non-ASCII goes in filename*");
        response.Content.Headers.ContentType!.MediaType.Should().Be("application/pdf");
    }

    [Fact]
    public async Task Render_forwards_query_values_as_parameters_but_not_the_routing_keys()
    {
        var service = new SpyReportingService();
        var client = Build(service, new StubAuthorizer());

        await client.GetAsync("/api/v1/reports/wo/render?workOrderId=42&locale=nl&timeZone=UTC&api-version=1.0");

        service.LastParameters.Should().ContainKey("workOrderId");
        service.LastParameters.Should().NotContainKeys("locale", "timeZone", "api-version");
        service.LastLocale.Should().Be("nl", "locale is read, just not forwarded as a parameter");
    }

    [Fact]
    public async Task Parameter_collection_is_case_insensitive()
    {
        var service = new SpyReportingService();
        await Build(service, new StubAuthorizer())
            .GetAsync("/api/v1/reports/wo/render?WorkOrderId=42&LOCALE=de");

        service.LastParameters.Should().ContainKey("workorderid");
        service.LastParameters.Should().NotContainKey("LOCALE", "the exclusion list is case-insensitive too");
    }

    [Fact]
    public async Task An_empty_query_value_is_not_forwarded_as_a_parameter()
    {
        // An empty string is absence, not a value — forwarding it makes a required parameter
        // look supplied and pushes the failure into the data provider.
        var service = new SpyReportingService();
        await Build(service, new StubAuthorizer()).GetAsync("/api/v1/reports/wo/render?workOrderId=");

        service.LastParameters.Should().NotContainKey("workOrderId");
    }

    [Fact]
    public async Task A_bad_parameter_is_400_and_an_unknown_report_is_404_on_render()
    {
        var client = Build(new SpyReportingService(), new StubAuthorizer());

        (await client.GetAsync("/api/v1/reports/wo/render?bad=1")).StatusCode
            .Should().Be(HttpStatusCode.BadRequest);
        (await client.GetAsync("/api/v1/reports/missing/render")).StatusCode
            .Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Preview_defaults_the_locale_when_the_body_omits_it()
    {
        var service = new SpyReportingService();
        var client = Build(service, new StubAuthorizer());

        await client.PostAsJsonAsync("/api/v1/reports/wo/preview", new PreviewRequest(null, null, null));

        service.LastLocale.Should().Be("en");
        service.LastParameters.Should().BeEmpty("a null parameter bag is none, not a failure");
    }

    [Fact]
    public async Task The_route_prefix_is_configurable()
    {
        // A host that already versions its API differently should not have to accept ours.
        var response = await Build(new SpyReportingService(), new StubAuthorizer(), "/reports")
            .GetAsync("/reports");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }
}
