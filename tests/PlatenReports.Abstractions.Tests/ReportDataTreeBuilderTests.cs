using System.Globalization;
using FluentAssertions;
using Xunit;

namespace PlatenReports.Abstractions.Tests;

public class ReportDataTreeBuilderTests
{
    private enum Status { Open, Closed }

    private sealed record Line(string Sku, decimal Total);

    private sealed record Order(string Number, Status Status, DateTime PlacedAt, IReadOnlyList<Line> Lines);

    [Fact]
    public void Property_names_become_camel_case_keys()
    {
        var tree = ReportDataTreeBuilder.Build(new { OrderNumber = "A-1" });

        tree.Should().ContainKey("orderNumber");
    }

    [Fact]
    public void Enums_become_their_name_so_templates_and_conditions_see_text()
    {
        var tree = ReportDataTreeBuilder.Build(
            new Order("A-1", Status.Closed, DateTime.UnixEpoch, []));

        tree["status"].Should().Be("Closed");
    }

    [Fact]
    public void Scalars_are_carried_through_unconverted()
    {
        var placedAt = new DateTime(2026, 4, 3, 10, 0, 0, DateTimeKind.Utc);

        var tree = ReportDataTreeBuilder.Build(new Order("A-1", Status.Open, placedAt, []));

        tree["number"].Should().Be("A-1");
        tree["placedAt"].Should().Be(placedAt);
    }

    [Fact]
    public void Collections_become_lists_of_nodes()
    {
        var tree = ReportDataTreeBuilder.Build(
            new Order("A-1", Status.Open, DateTime.UnixEpoch, [new Line("SKU-1", 9.5m)]));

        var lines = tree["lines"].Should().BeAssignableTo<IReadOnlyList<object?>>().Subject;
        var first = lines[0].Should().BeAssignableTo<IReadOnlyDictionary<string, object?>>().Subject;
        first["sku"].Should().Be("SKU-1");
        first["total"].Should().Be(9.5m);
    }

    [Fact]
    public void Dictionary_keys_are_camel_cased_too()
    {
        var tree = ReportDataTreeBuilder.Build(
            new { Extras = new Dictionary<string, object?> { ["SomeKey"] = 1 } });

        var extras = tree["extras"].Should().BeAssignableTo<IReadOnlyDictionary<string, object?>>().Subject;
        extras.Should().ContainKey("someKey");
    }

    [Fact]
    public void Nesting_stops_at_the_depth_cap_rather_than_recursing_forever()
    {
        // The cap is a cycle guard: pass acyclic data. Beyond it a node degrades to its
        // string form instead of hanging the render.
        object nested = new { Value = "leaf" };
        for (var i = 0; i < 8; i++)
        {
            nested = new { Child = nested };
        }

        var act = () => ReportDataTreeBuilder.Build(nested);

        act.Should().NotThrow();
    }

    [Fact]
    public void BuildList_converts_each_item()
    {
        var list = ReportDataTreeBuilder.BuildList(new[] { new Line("A", 1m), new Line("B", 2m) });

        list.Should().HaveCount(2);
        list.Select(i => ((IReadOnlyDictionary<string, object?>)i!)["sku"]).Should().Equal("A", "B");
    }
}

public class ReportCultureTests
{
    [Fact]
    public void A_known_locale_resolves()
    {
        ReportCulture.Resolve("nl-NL").Name.Should().Be("nl-NL");
    }

    [Fact]
    public void A_nonsense_locale_never_throws()
    {
        // The guarantee that matters: a bad value from a caller must never make a report
        // unprintable. What comes back is deterministic, but not necessarily invariant.
        var act = () => ReportCulture.Resolve("not-a-locale");

        act.Should().NotThrow();
    }

    [Fact]
    public void A_hyphenated_nonsense_locale_resolves_to_its_first_segment()
    {
        // Pinning a known sharp edge: .NET resolves far more names than exist as real
        // cultures, so "not-a-locale" yields a neutral culture named "not" rather than
        // falling back to invariant. Tracked as platen-reports#4.
        ReportCulture.Resolve("not-a-locale").Name.Should().Be("not");
    }

    [Fact]
    public void The_empty_string_is_the_invariant_culture()
    {
        ReportCulture.Resolve(string.Empty).Should().Be(CultureInfo.InvariantCulture);
    }
}
