using FluentAssertions;
using Xunit;

namespace PlatenReports.Abstractions.Tests;

public class ReportFieldNodeTests
{
    private static readonly ReportFieldNode Root = ReportFieldNode.Object(
        "$root",
        ReportFieldNode.Object(
            "order",
            ReportFieldNode.Scalar("number"),
            ReportFieldNode.Object("customer", ReportFieldNode.Scalar("name"))),
        ReportFieldNode.Collection(
            "lines",
            ReportFieldNode.Scalar("sku"),
            ReportFieldNode.Scalar("total", "number")));

    [Fact]
    public void ConditionPaths_returns_scalar_leaves_by_dotted_path()
    {
        ReportFieldNode.ConditionPaths(Root)
            .Should().BeEquivalentTo("order.number", "order.customer.name");
    }

    [Fact]
    public void ConditionPaths_does_not_traverse_collections()
    {
        // A condition is evaluated against a flat scope that has no collection in it, so
        // accepting "lines.total" at authoring time would hide the element on every print
        // instead of telling the author their path is unreachable.
        ReportFieldNode.ConditionPaths(Root).Should().NotContain(p => p.StartsWith("lines", StringComparison.Ordinal));
    }

    [Fact]
    public void ConditionPaths_stops_at_the_depth_bound()
    {
        var deep = ReportFieldNode.Object("$root",
            ReportFieldNode.Object("a", ReportFieldNode.Object("b", ReportFieldNode.Scalar("c"))));

        ReportFieldNode.ConditionPaths(deep, maxDepth: 1).Should().BeEmpty();
        ReportFieldNode.ConditionPaths(deep, maxDepth: 2).Should().Contain("a.b.c");
    }

    [Fact]
    public void PathExists_traverses_collections_because_a_table_bind_targets_them()
    {
        var roots = Root.Children!;

        ReportFieldNode.PathExists(roots, "lines").Should().BeTrue();
        ReportFieldNode.PathExists(roots, "lines.total").Should().BeTrue();
        ReportFieldNode.PathExists(roots, "order.customer.name").Should().BeTrue();
    }

    [Fact]
    public void PathExists_rejects_an_unknown_segment()
    {
        var roots = Root.Children!;

        ReportFieldNode.PathExists(roots, "order.missing").Should().BeFalse();
        ReportFieldNode.PathExists(roots, "nope").Should().BeFalse();
    }
}
