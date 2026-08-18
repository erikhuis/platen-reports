using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace PlatenReports.NCalc;

/// <summary>Registers the NCalc condition evaluator with a host's service collection.</summary>
public static class ServiceCollectionExtensions
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
