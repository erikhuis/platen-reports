// Deliberately NO `using PlatenReports…` of any kind. The whole point of declaring the DI
// extensions in Microsoft.Extensions.DependencyInjection is that a host's Program.cs — which
// already has this using — reaches them without importing a product namespace. If someone moves
// them back into PlatenReports.*, this file stops compiling, which is the intended alarm.
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

// Also deliberately outside PlatenReports.*: a namespace under it would inherit the product
// namespaces implicitly and the test would pass without proving anything.
namespace HostWiring.ConventionProof;

/// <summary>Proves the DI extensions are reachable the way a host actually reaches them.</summary>
public class HostWiringConventionTests
{
    [Fact]
    public void Both_packages_extend_IServiceCollection_with_only_the_Microsoft_using()
    {
        var services = new ServiceCollection();

        // Neither call names a Platen namespace. Both resolve through the shared namespace.
        services.AddPlatenReports();
        services.AddNCalcReportConditions();
        services.AddAllowAllReportAuthorizer();

        services.Should().NotBeEmpty();
    }

    [Fact]
    public void Referencing_both_packages_is_unambiguous()
    {
        // The reason the classes are named for what they register rather than both being
        // ServiceCollectionExtensions: two identically-named static classes in one namespace are
        // ambiguous the moment either is referred to by name, and a host uses both packages.
        var services = new ServiceCollection().AddPlatenReports().AddNCalcReportConditions();

        NCalcReportingServiceCollectionExtensions.AddNCalcReportConditions(services).Should().BeSameAs(services);
        PlatenReportsServiceCollectionExtensions.AddPlatenReports(services).Should().BeSameAs(services);
    }
}
