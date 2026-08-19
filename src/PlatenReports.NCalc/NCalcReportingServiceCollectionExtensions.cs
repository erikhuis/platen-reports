using Microsoft.Extensions.DependencyInjection.Extensions;
using PlatenReports;
using PlatenReports.NCalc;

namespace Microsoft.Extensions.DependencyInjection;

/// <summary>Registers the NCalc condition evaluator with a host's service collection.</summary>
/// <remarks>
/// Declared in <c>Microsoft.Extensions.DependencyInjection</c> so the method surfaces in a host's
/// <c>Program.cs</c> without a further <c>using</c> — the convention most of the .NET ecosystem
/// follows for <c>Add*</c> extensions. The class is named for what it registers rather than
/// <c>ServiceCollectionExtensions</c>, because that namespace is shared with every other package
/// doing the same and a duplicate type name there is ambiguous the moment anyone refers to it.
/// </remarks>
public static class NCalcReportingServiceCollectionExtensions
{
    /// <summary>
    /// Registers <see cref="NCalcReportConditionEvaluator"/> as the singleton
    /// <see cref="IReportConditionEvaluator"/>.
    /// </summary>
    /// <remarks>
    /// Uses <c>TryAdd</c>, so a host that has already registered its own evaluator keeps it and
    /// this call is a no-op. That ordering-independence is deliberate: which of two
    /// <c>Add…</c> calls ran first should not decide how conditions are evaluated. To replace a
    /// registration on purpose, remove it or register after and resolve explicitly.
    /// </remarks>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    /// <exception cref="ArgumentNullException"><paramref name="services"/> is <see langword="null"/>.</exception>
    public static IServiceCollection AddNCalcReportConditions(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);
        services.TryAddSingleton<IReportConditionEvaluator, NCalcReportConditionEvaluator>();
        return services;
    }
}
