using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Xunit;
using static PlatenReports.AspNetCore.Tests.ReportingTestHost;

namespace PlatenReports.AspNetCore.Tests;

/// <summary>
/// The authorizer gate on every route.
/// </summary>
/// <remarks>
/// Two things are asserted for each refusal, not one: the status is <b>403</b>, and the engine
/// was <b>never called</b>. A gate that refuses after doing the work still leaks — timing, load,
/// and any side effect the call had — so "returns 403" alone would not prove the gate.
/// </remarks>
public class AuthorizationTests
{
    public static TheoryData<string, string, bool> CatalogueRoutes() => new()
    {
        { "GET",  "/api/v1/reports", true },
        { "GET",  "/api/v1/reports/wo/definition", true },
        { "GET",  "/api/v1/reports/wo/definition/standard", true },
        { "GET",  "/api/v1/reports/wo/fields", true },
    };

    [Theory]
    [MemberData(nameof(CatalogueRoutes))]
    public async Task Catalogue_routes_return_403_and_do_no_work_when_refused(string method, string url, bool _)
    {
        var service = new SpyReportingService();
        var client = Build(service, new StubAuthorizer(catalogue: false));

        var response = await client.SendAsync(new HttpRequestMessage(new HttpMethod(method), url));

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        service.Calls.Should().BeEmpty("the gate must run before any work");
    }

    [Theory]
    [InlineData("GET", "/api/v1/reports/wo/overlay")]
    [InlineData("DELETE", "/api/v1/reports/wo/overlay")]
    public async Task Overlay_reads_and_deletes_return_403_when_management_is_refused(string method, string url)
    {
        var service = new SpyReportingService();
        var client = Build(service, new StubAuthorizer(manage: false));

        var response = await client.SendAsync(new HttpRequestMessage(new HttpMethod(method), url));

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        service.Calls.Should().BeEmpty();
    }

    [Theory]
    [InlineData("/api/v1/reports/wo/overlay")]
    [InlineData("/api/v1/reports/wo/overlay/validate")]
    public async Task Overlay_writes_return_403_before_the_body_is_even_considered(string url)
    {
        // The gate runs before the body check, so an *invalid* body still gets 403 rather than
        // 400 — refusing tells an unauthorized caller nothing about what a valid body looks like.
        var service = new SpyReportingService();
        var client = Build(service, new StubAuthorizer(manage: false));

        var response = url.EndsWith("validate", StringComparison.Ordinal)
            ? await client.PostAsJsonAsync(url, new PutOverlayRequest("", true))
            : await client.PutAsJsonAsync(url, new PutOverlayRequest("", true));

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        service.Calls.Should().BeEmpty();
    }

    [Fact]
    public async Task Render_returns_403_when_refused()
    {
        var service = new SpyReportingService();
        var client = Build(service, new StubAuthorizer(render: false));

        var response = await client.GetAsync("/api/v1/reports/wo/render");

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        service.Calls.Should().NotContain(nameof(SpyReportingService.RenderAsync));
    }

    [Fact]
    public async Task Render_hands_the_authorizer_the_key_and_the_declared_permission()
    {
        // The whole reason CanRenderAsync takes them: a host gates on the data a report prints,
        // not just on the act of printing.
        var service = new SpyReportingService { RequiredPermission = "WorkOrders.View" };
        var auth = new StubAuthorizer();
        var client = Build(service, auth);

        await client.GetAsync("/api/v1/reports/wo/render");

        auth.LastRenderKey.Should().Be("wo");
        auth.LastRequiredPermission.Should().Be("WorkOrders.View");
    }

    [Fact]
    public async Task Preview_requires_both_management_and_render_rights()
    {
        // Preview renders live data, so the authoring right alone must not be enough — otherwise
        // it becomes a way to read what the caller may not print.
        var service = new SpyReportingService();
        var client = Build(service, new StubAuthorizer(manage: true, render: false));

        var response = await client.PostAsJsonAsync(
            "/api/v1/reports/wo/preview", new PreviewRequest(null, null, "en"));

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        service.Calls.Should().NotContain(nameof(SpyReportingService.RenderAsync));
    }

    [Fact]
    public async Task Preview_asks_for_management_first()
    {
        var service = new SpyReportingService();
        var auth = new StubAuthorizer(manage: false, render: false);
        var client = Build(service, auth);

        await client.PostAsJsonAsync("/api/v1/reports/wo/preview", new PreviewRequest(null, null, "en"));

        auth.Asked.Should().ContainSingle().Which.Should().Be(nameof(IReportAuthorizer.CanManageDefinitionsAsync));
    }

    [Fact]
    public async Task A_refusal_is_403_and_never_a_redirect()
    {
        // Results.Forbid() would delegate to an authentication scheme this package cannot assume
        // exists, and a cookie handler answers with a 302 to a login page. An API must refuse.
        var client = Build(new SpyReportingService(), new StubAuthorizer(catalogue: false));

        var response = await client.GetAsync("/api/v1/reports");

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        response.Headers.Location.Should().BeNull();
    }

    [Fact]
    public async Task An_unknown_report_reaches_the_authorizer_with_a_null_permission()
    {
        // The engine looks the permission up with ?. rather than asserting existence, so an
        // unknown key arrives as null — indistinguishable from "declares none". Pinned because
        // an implementation's choice between allowing (then 404) and denying (hiding existence)
        // depends on knowing this happens at all.
        var auth = new StubAuthorizer();
        var client = Build(new SpyReportingService(), auth);

        var response = await client.GetAsync("/api/v1/reports/missing/render");

        auth.LastRenderKey.Should().Be("missing");
        auth.LastRequiredPermission.Should().BeNull();
        response.StatusCode.Should().Be(HttpStatusCode.NotFound, "allowing lets the engine answer");
    }

    [Fact]
    public async Task A_host_that_forgets_the_authorizer_serves_nothing()
    {
        // The security property behind shipping no default. Resolution fails rather than
        // falling back to something permissive, so forgetting to register one cannot quietly
        // publish the reporting surface to everyone.
        using var host = new Microsoft.Extensions.Hosting.HostBuilder()
            .ConfigureWebHost(web =>
            {
                web.UseTestServer();
                web.ConfigureServices(s =>
                {
                    s.AddRouting();
                    s.AddSingleton<IReportingService>(new SpyReportingService());
                });
                web.Configure(app =>
                {
                    app.UseRouting();
                    app.UseEndpoints(e => e.MapReportEndpoints());
                });
            })
            .Start();

        var act = async () => await host.GetTestClient().GetAsync("/api/v1/reports");

        await act.Should().ThrowAsync<InvalidOperationException>();
    }
}
