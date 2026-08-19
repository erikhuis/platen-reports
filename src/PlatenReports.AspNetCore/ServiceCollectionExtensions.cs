using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace PlatenReports.AspNetCore;

/// <summary>Wires the reporting engine into a host's service collection.</summary>
/// <remarks>
/// Extensions live in this package's own namespace rather than
/// <c>Microsoft.Extensions.DependencyInjection</c>, matching <c>PlatenReports.NCalc</c>'s
/// <c>AddNCalcReportConditions()</c>. A host adds one <c>using</c> and gets every
/// Platen registration together.
/// </remarks>
public static class ServiceCollectionExtensions
{
    /// <summary>
    /// Registers <see cref="IReportingService"/> and the two collaborators it takes that have
    /// sensible defaults. The host still supplies the ports the engine cannot invent: a data
    /// provider registry, a renderer, a definition source, a condition evaluator, an asset
    /// provider, an overlay store, and an <see cref="IReportAuthorizer"/>.
    /// </summary>
    /// <remarks>
    /// <para>Takes an options <em>instance</em> rather than the usual <c>Action&lt;T&gt;</c>
    /// callback, because <see cref="ReportingOptions"/> is immutable — its properties are
    /// <c>init</c>-only — so a callback would have nothing it could set.</para>
    /// <para>Deliberately registers <b>no</b> <see cref="IReportAuthorizer"/>. There is no safe
    /// default: a permissive one would open every endpoint in any host that forgot, and a
    /// restrictive one would look like a bug. With none registered the endpoints fail closed at
    /// resolution, which is loud and immediate. <see cref="AddAllowAllReportAuthorizer"/> is the
    /// opt-in for samples and tests.</para>
    /// </remarks>
    /// <param name="services">The service collection.</param>
    /// <param name="options">Engine options. Omit for <see cref="ReportingOptions.Default"/>.</param>
    /// <returns>The same collection, for chaining.</returns>
    /// <exception cref="ArgumentNullException"><paramref name="services"/> is <see langword="null"/>.</exception>
    public static IServiceCollection AddPlatenReports(
        this IServiceCollection services, ReportingOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(services);

        // Registered so a supplied instance actually reaches the engine. ReportingService takes
        // ReportingOptions as an optional constructor parameter and the container does honour
        // default parameter values, so resolution would succeed without this — it would just
        // silently use ReportingOptions.Default and ignore what the caller passed.
        //
        // TimeProvider is deliberately NOT registered. ReportingService already falls back to
        // TimeProvider.System, so a registration here would buy nothing while claiming a BCL
        // slot a host may well want for its own fake clock.
        services.TryAddSingleton(options ?? ReportingOptions.Default);

        services.TryAddScoped<IReportingService, ReportingService>();
        return services;
    }

    /// <summary>
    /// Registers <see cref="AllowAllReportAuthorizer"/> — every reporting endpoint open to every
    /// caller — and a hosted service that says so in the log at startup.
    /// </summary>
    /// <remarks>
    /// For samples, local development and tests. The warning is not decoration: a host that ships
    /// this to production has no authorization on its reporting surface at all, including render.
    /// </remarks>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    /// <exception cref="ArgumentNullException"><paramref name="services"/> is <see langword="null"/>.</exception>
    public static IServiceCollection AddAllowAllReportAuthorizer(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);
        services.TryAddSingleton<IReportAuthorizer, AllowAllReportAuthorizer>();
        services.AddHostedService<AllowAllReportAuthorizerWarning>();
        return services;
    }
}
