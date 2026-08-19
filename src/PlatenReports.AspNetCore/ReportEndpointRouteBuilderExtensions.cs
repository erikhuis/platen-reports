using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Net.Http.Headers;
using PlatenReports.Model;

namespace PlatenReports.AspNetCore;

/// <summary>Maps the reporting HTTP surface onto a host's router.</summary>
public static class ReportEndpointRouteBuilderExtensions
{
    /// <summary>Query keys that are routing or presentation concerns, never report parameters.</summary>
    private static readonly string[] NonParameterQueryKeys = ["locale", "timeZone", "version", "api-version"];

    /// <summary>Maps every reporting endpoint under <paramref name="prefix"/>.</summary>
    /// <remarks>
    /// <para>Minimal APIs rather than a controller, so a host is not forced into MVC to serve
    /// reports. The group is returned so a host can layer its own conventions onto it —
    /// <c>RequireAuthorization</c>, rate limits, CORS, OpenAPI metadata — none of which this
    /// package presumes.</para>
    /// <para><b>Authorization is the host's, through <see cref="IReportAuthorizer"/>.</b> Every
    /// endpoint asks before doing any work and answers a plain <c>403</c> when refused —
    /// deliberately not <c>Results.Forbid()</c>, which delegates to an authentication scheme this
    /// package cannot assume exists and which redirects rather than refusing when the scheme is a
    /// cookie handler. Refusal here is an API answer, not a login prompt.</para>
    /// </remarks>
    /// <param name="endpoints">The route builder to map onto.</param>
    /// <param name="prefix">Route prefix. Defaults to <c>/api/v1/reports</c>.</param>
    /// <returns>The mapped group, for further configuration.</returns>
    /// <exception cref="ArgumentNullException"><paramref name="endpoints"/> is <see langword="null"/>.</exception>
    public static RouteGroupBuilder MapReportEndpoints(
        this IEndpointRouteBuilder endpoints, string prefix = "/api/v1/reports")
    {
        ArgumentNullException.ThrowIfNull(endpoints);
        var group = endpoints.MapGroup(prefix);

        group.MapGet("/", async (IReportingService service, IReportAuthorizer auth,
            string? locale, CancellationToken ct) =>
            await auth.CanViewCatalogueAsync(ct)
                ? Results.Ok(await service.ListAsync(locale, ct))
                : Forbidden());

        group.MapGet("/{key}/definition", async (IReportingService service, IReportAuthorizer auth,
            string key, CancellationToken ct) =>
        {
            if (!await auth.CanViewCatalogueAsync(ct))
            {
                return Forbidden();
            }

            var result = await service.GetEffectiveDefinitionAsync(key, ct);
            return result is null ? Results.NotFound() : Results.Ok(result);
        });

        group.MapGet("/{key}/definition/standard", async (IReportingService service, IReportAuthorizer auth,
            string key, CancellationToken ct) =>
        {
            if (!await auth.CanViewCatalogueAsync(ct))
            {
                return Forbidden();
            }

            string? json = service.GetStandardDefinitionJson(key);
            // Content, not Ok: this is already JSON. Ok would serialize the string, wrapping it
            // in quotes and escaping every brace.
            return json is null ? Results.NotFound() : Results.Content(json, "application/json");
        });

        group.MapGet("/{key}/fields", async (IReportingService service, IReportAuthorizer auth,
            string key, CancellationToken ct) =>
        {
            if (!await auth.CanViewCatalogueAsync(ct))
            {
                return Forbidden();
            }

            var fields = service.GetFields(key);
            return fields is null ? Results.NotFound() : Results.Ok(fields);
        });

        group.MapGet("/{key}/overlay", async (IReportingService service, IReportAuthorizer auth,
            string key, CancellationToken ct) =>
        {
            if (!await auth.CanManageDefinitionsAsync(ct))
            {
                return Forbidden();
            }

            var overlay = await service.GetOverlayAsync(key, ct);
            return overlay is null ? Results.NotFound() : Results.Ok(overlay);
        });

        group.MapPut("/{key}/overlay", async (IReportingService service, IReportAuthorizer auth,
            string key, PutOverlayRequest request, CancellationToken ct) =>
        {
            if (!await auth.CanManageDefinitionsAsync(ct))
            {
                return Forbidden();
            }

            if (string.IsNullOrWhiteSpace(request.OverlayJson))
            {
                return Results.BadRequest(new { error = "overlayJson is required." });
            }

            try
            {
                return Results.Ok(await service.PutOverlayAsync(key, request.OverlayJson, request.IsEnabled, ct));
            }
            catch (KeyNotFoundException)
            {
                return Results.NotFound();
            }
            catch (ReportValidationException ex)
            {
                // The validation shape, not a bare error string: the caller is an editor that
                // renders these against the elements that produced them.
                return Results.BadRequest(new OverlayValidationResultDto(false, ex.Errors, []));
            }
        });

        group.MapDelete("/{key}/overlay", async (IReportingService service, IReportAuthorizer auth,
            string key, CancellationToken ct) =>
        {
            if (!await auth.CanManageDefinitionsAsync(ct))
            {
                return Forbidden();
            }

            return await service.DeleteOverlayAsync(key, ct) ? Results.NoContent() : Results.NotFound();
        });

        group.MapPost("/{key}/overlay/validate", async (IReportingService service, IReportAuthorizer auth,
            string key, PutOverlayRequest request, CancellationToken ct) =>
        {
            if (!await auth.CanManageDefinitionsAsync(ct))
            {
                return Forbidden();
            }

            if (string.IsNullOrWhiteSpace(request.OverlayJson))
            {
                return Results.BadRequest(new { error = "overlayJson is required." });
            }

            try
            {
                return Results.Ok(await service.ValidateOverlayAsync(key, request.OverlayJson, ct));
            }
            catch (KeyNotFoundException)
            {
                return Results.NotFound();
            }
        });

        group.MapGet("/{key}/render", async (IReportingService service, IReportAuthorizer auth,
            HttpContext http, string key, string? locale, string? timeZone, CancellationToken ct) =>
        {
            if (!await auth.CanRenderAsync(key, service.GetRequiredPermission(key), ct))
            {
                return Forbidden();
            }

            try
            {
                var result = await service.RenderAsync(
                    key, CollectParameters(http.Request), locale ?? "en", null, timeZone, null, ct);

                // Inline, not attachment. The File(..., fileName) overload sets
                // Content-Disposition: attachment, which turns a print tab into a download and
                // leaves the tab blank. SetHttpFileName still supplies a save-as name, RFC 5987
                // encoded for non-ASCII.
                var disposition = new ContentDispositionHeaderValue("inline");
                disposition.SetHttpFileName(result.FileName);
                http.Response.Headers[HeaderNames.ContentDisposition] = disposition.ToString();
                return Results.File(result.Content, result.ContentType);
            }
            catch (KeyNotFoundException ex)
            {
                return Results.NotFound(new { error = ex.Message });
            }
            catch (ReportParameterException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        group.MapPost("/{key}/preview", async (IReportingService service, IReportAuthorizer auth,
            string key, PreviewRequest request, CancellationToken ct) =>
        {
            // Two gates, not one. Preview is an authoring feature, so it needs the authoring
            // right — but it renders the same live data as a real render, so it needs the render
            // right for this report too. Checking only the first would make preview a way to read
            // data the caller may not print.
            if (!await auth.CanManageDefinitionsAsync(ct))
            {
                return Forbidden();
            }

            if (!await auth.CanRenderAsync(key, service.GetRequiredPermission(key), ct))
            {
                return Forbidden();
            }

            try
            {
                var result = await service.RenderAsync(
                    key,
                    request.Parameters ?? [],
                    request.Locale ?? "en",
                    request.OverlayJson,
                    request.TimeZone,
                    request.DefinitionJson,
                    ct);
                return Results.File(result.Content, result.ContentType, result.FileName);
            }
            catch (KeyNotFoundException ex)
            {
                return Results.NotFound(new { error = ex.Message });
            }
            catch (ReportParameterException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (ReportValidationException ex)
            {
                return Results.BadRequest(new OverlayValidationResultDto(false, ex.Errors, []));
            }
        });

        return group;
    }

    /// <summary>A bare 403 — see the remarks on <see cref="MapReportEndpoints"/>.</summary>
    private static IResult Forbidden() => Results.StatusCode(StatusCodes.Status403Forbidden);

    /// <summary>
    /// Every query value except the routing and presentation keys, treated as report parameters.
    /// </summary>
    /// <remarks>
    /// Case-insensitive, because a definition's parameter names and a hand-written query string
    /// rarely agree on casing. Repeated keys keep the first value: a report parameter is scalar,
    /// and silently concatenating or last-wins would both be surprising.
    /// </remarks>
    private static Dictionary<string, string> CollectParameters(HttpRequest request)
    {
        var parameters = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (queryKey, values) in request.Query)
        {
            if (NonParameterQueryKeys.Contains(queryKey, StringComparer.OrdinalIgnoreCase))
            {
                continue;
            }

            if (values.Count > 0 && values[0] is { Length: > 0 } value)
            {
                parameters[queryKey] = value;
            }
        }

        return parameters;
    }
}
