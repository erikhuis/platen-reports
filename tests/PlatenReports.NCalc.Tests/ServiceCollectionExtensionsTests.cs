using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace PlatenReports.NCalc.Tests;

/// <summary>The one-line opt-in a host uses to wire this evaluator up.</summary>
public class ServiceCollectionExtensionsTests
{
    [Fact]
    public void Registers_the_evaluator_as_a_singleton()
    {
        var provider = new ServiceCollection().AddNCalcReportConditions().BuildServiceProvider();

        var first = provider.GetRequiredService<IReportConditionEvaluator>();
        first.Should().BeOfType<NCalcReportConditionEvaluator>();
        provider.GetRequiredService<IReportConditionEvaluator>().Should().BeSameAs(first);
    }

    [Fact]
    public void Leaves_a_host_registration_in_place()
    {
        // TryAdd, so wiring order does not decide how conditions evaluate.
        var services = new ServiceCollection();
        services.AddSingleton<IReportConditionEvaluator, StubEvaluator>();

        services.AddNCalcReportConditions();

        services.BuildServiceProvider().GetRequiredService<IReportConditionEvaluator>()
            .Should().BeOfType<StubEvaluator>();
    }

    [Fact]
    public void Is_idempotent()
    {
        var provider = new ServiceCollection()
            .AddNCalcReportConditions()
            .AddNCalcReportConditions()
            .BuildServiceProvider();

        provider.GetServices<IReportConditionEvaluator>().Should().ContainSingle();
    }

    [Fact]
    public void Rejects_a_null_collection()
    {
        var act = () => ((IServiceCollection)null!).AddNCalcReportConditions();
        act.Should().Throw<ArgumentNullException>();
    }

    private sealed class StubEvaluator : IReportConditionEvaluator
    {
        public ConditionResult Evaluate(string expression, IReadOnlyDictionary<string, object?> scope) =>
            ConditionResult.Shown;

        public IReadOnlyList<string> Validate(string expression, IReadOnlySet<string>? knownPaths = null) => [];
    }
}
