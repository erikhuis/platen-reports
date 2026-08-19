using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace PlatenReports.AspNetCore;

/// <summary>
/// An <see cref="IReportAuthorizer"/> that allows everything. For samples, local development
/// and tests — never for anything reachable from a network you do not control.
/// </summary>
/// <remarks>
/// Named for what it does rather than what it is for, so that a host wiring it up cannot mistake
/// it for a default. It is never registered by <c>MapReportEndpoints</c> or by
/// <c>AddPlatenReports</c>; opting in takes an explicit <c>AddAllowAllReportAuthorizer()</c>,
/// and that call also registers a hosted service that logs a warning at startup — see
/// <see cref="AllowAllReportAuthorizerWarning"/>.
/// </remarks>
public sealed class AllowAllReportAuthorizer : IReportAuthorizer
{
    /// <inheritdoc />
    public ValueTask<bool> CanViewCatalogueAsync(CancellationToken ct = default) => ValueTask.FromResult(true);

    /// <inheritdoc />
    public ValueTask<bool> CanManageDefinitionsAsync(CancellationToken ct = default) => ValueTask.FromResult(true);

    /// <inheritdoc />
    public ValueTask<bool> CanRenderAsync(string reportKey, string? requiredPermission, CancellationToken ct = default) =>
        ValueTask.FromResult(true);
}

/// <summary>Logs, once at startup, that report authorization is disabled.</summary>
/// <remarks>
/// A hosted service rather than a constructor log, so the warning appears when the application
/// starts rather than whenever something first happens to resolve the authorizer. A warning that
/// only surfaces on the first request is one nobody reads until it is already too late.
/// </remarks>
internal sealed class AllowAllReportAuthorizerWarning(
    IReportAuthorizer authorizer, ILogger<AllowAllReportAuthorizer> logger) : IHostedService
{
    public Task StartAsync(CancellationToken cancellationToken)
    {
        // AddAllowAllReportAuthorizer registers with TryAddSingleton, so it is a no-op when a
        // host already registered its own IReportAuthorizer first — check what actually won
        // resolution, or this cries wolf over a host that is in fact using its own authorizer.
        if (authorizer is AllowAllReportAuthorizer)
        {
            logger.LogWarning(
                "Platen Reports is using AllowAllReportAuthorizer: every reporting endpoint is open to " +
                "every caller, including report rendering. This is intended for samples, local " +
                "development and tests. Register your own IReportAuthorizer before exposing these " +
                "endpoints to anyone.");
        }

        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
