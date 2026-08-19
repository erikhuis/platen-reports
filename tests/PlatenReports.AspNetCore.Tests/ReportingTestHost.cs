using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using PlatenReports.Model;

namespace PlatenReports.AspNetCore.Tests;

/// <summary>
/// A minimal host with the endpoints mapped, exercised over a real request pipeline.
/// </summary>
/// <remarks>
/// Deliberately a real pipeline rather than calls into the lambdas. Half of what these endpoints
/// promise is HTTP-shaped — status codes, a Content-Disposition header, JSON casing, model
/// binding of the request bodies — and none of that is observable from a direct invocation.
/// </remarks>
internal static class ReportingTestHost
{
    internal static HttpClient Build(IReportingService service, IReportAuthorizer authorizer, string? prefix = null)
    {
        var builder = new HostBuilder().ConfigureWebHost(web =>
        {
            web.UseTestServer();
            web.ConfigureServices(s =>
            {
                s.AddRouting();
                s.AddSingleton(service);
                s.AddSingleton(authorizer);
            });
            web.Configure(app =>
            {
                app.UseRouting();
                app.UseEndpoints(e =>
                {
                    if (prefix is null)
                    {
                        e.MapReportEndpoints();
                    }
                    else
                    {
                        e.MapReportEndpoints(prefix);
                    }
                });
            });
        });

        var host = builder.Start();
        return host.GetTestClient();
    }

    /// <summary>Answers whatever it is told to, and records what it was asked.</summary>
    internal sealed class StubAuthorizer(bool catalogue = true, bool manage = true, bool render = true)
        : IReportAuthorizer
    {
        internal List<string> Asked { get; } = [];
        internal string? LastRenderKey { get; private set; }
        internal string? LastRequiredPermission { get; private set; }

        public ValueTask<bool> CanViewCatalogueAsync(CancellationToken ct = default)
        {
            Asked.Add(nameof(CanViewCatalogueAsync));
            return ValueTask.FromResult(catalogue);
        }

        public ValueTask<bool> CanManageDefinitionsAsync(CancellationToken ct = default)
        {
            Asked.Add(nameof(CanManageDefinitionsAsync));
            return ValueTask.FromResult(manage);
        }

        public ValueTask<bool> CanRenderAsync(string reportKey, string? requiredPermission, CancellationToken ct = default)
        {
            Asked.Add(nameof(CanRenderAsync));
            LastRenderKey = reportKey;
            LastRequiredPermission = requiredPermission;
            return ValueTask.FromResult(render);
        }
    }

    /// <summary>Records every call, so a test can assert the endpoint never reached the engine.</summary>
    internal sealed class SpyReportingService : IReportingService
    {
        internal List<string> Calls { get; } = [];
        internal string? RequiredPermission { get; init; }

        public Task<IReadOnlyList<ReportCatalogueItemDto>> ListAsync(string? locale = null, CancellationToken ct = default)
        {
            Calls.Add(nameof(ListAsync));
            return Task.FromResult<IReadOnlyList<ReportCatalogueItemDto>>([
                new ReportCatalogueItemDto("wo", "Work order", "1.0.0", "src", null, false, false,
                    [new ReportParameterDto("id", "guid", true)]),
            ]);
        }

        public Task<EffectiveDefinitionDto?> GetEffectiveDefinitionAsync(string reportKey, CancellationToken ct = default)
        {
            Calls.Add(nameof(GetEffectiveDefinitionAsync));
            return Task.FromResult<EffectiveDefinitionDto?>(
                reportKey == "missing" ? null : new EffectiveDefinitionDto("{}", "1.0.0", []));
        }

        public string? GetStandardDefinitionJson(string reportKey)
        {
            Calls.Add(nameof(GetStandardDefinitionJson));
            return reportKey == "missing" ? null : """{"key":"wo"}""";
        }

        public ReportFieldNode? GetFields(string reportKey)
        {
            Calls.Add(nameof(GetFields));
            return reportKey == "missing" ? null : new ReportFieldNode("root", "object");
        }

        public string? GetRequiredPermission(string reportKey) => RequiredPermission;

        public Task<ReportOverlayDto?> GetOverlayAsync(string reportKey, CancellationToken ct = default)
        {
            Calls.Add(nameof(GetOverlayAsync));
            return Task.FromResult<ReportOverlayDto?>(reportKey == "missing"
                ? null
                : new ReportOverlayDto("wo", "{}", "1.0.0", true, new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc)));
        }

        public Task<OverlayValidationResultDto> PutOverlayAsync(
            string reportKey, string overlayJson, bool isEnabled, CancellationToken ct = default)
        {
            Calls.Add(nameof(PutOverlayAsync));
            if (reportKey == "missing")
            {
                throw new KeyNotFoundException();
            }

            if (overlayJson.Contains("bad", StringComparison.Ordinal))
            {
                throw new ReportValidationException(["nope"]);
            }

            return Task.FromResult(new OverlayValidationResultDto(true, [], []));
        }

        public Task<bool> DeleteOverlayAsync(string reportKey, CancellationToken ct = default)
        {
            Calls.Add(nameof(DeleteOverlayAsync));
            return Task.FromResult(reportKey != "missing");
        }

        public Task<OverlayValidationResultDto> ValidateOverlayAsync(
            string reportKey, string overlayJson, CancellationToken ct = default)
        {
            Calls.Add(nameof(ValidateOverlayAsync));
            if (reportKey == "missing")
            {
                throw new KeyNotFoundException();
            }

            return Task.FromResult(new OverlayValidationResultDto(true, [], []));
        }

        public Task<ReportRenderResult> RenderAsync(
            string reportKey, IReadOnlyDictionary<string, string> parameters, string locale,
            string? draftOverlayJson = null, string? timeZone = null, string? draftDefinitionJson = null,
            CancellationToken ct = default)
        {
            Calls.Add(nameof(RenderAsync));
            LastParameters = parameters;
            LastLocale = locale;
            if (reportKey == "missing")
            {
                throw new KeyNotFoundException("no such report");
            }

            if (parameters.ContainsKey("bad"))
            {
                throw new ReportParameterException("bad parameter");
            }

            return Task.FromResult(new ReportRenderResult([1, 2, 3], "wo — ünïcode.pdf", "application/pdf", []));
        }

        internal IReadOnlyDictionary<string, string>? LastParameters { get; private set; }
        internal string? LastLocale { get; private set; }
    }
}
