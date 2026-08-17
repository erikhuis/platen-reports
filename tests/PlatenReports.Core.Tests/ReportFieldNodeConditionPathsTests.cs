using FluentAssertions;
using Xunit;

namespace PlatenReports.Core.Tests;

/// <summary>
/// Issue #2439 — <see cref="ReportFieldNode.ConditionPaths"/> is the authoring-time known-field
/// set for <c>visibleIf</c>. It has to mirror <c>ReportPathBinder.FlattenForConditions</c>, which
/// is what actually builds the scope at render time; anything it accepts that the flattener will
/// not produce turns into an element that silently disappears on every print.
/// </summary>
public class ReportFieldNodeConditionPathsTests
{
    private static readonly ReportFieldNode Tree = ReportFieldNode.Object(
        "$root",
        ReportFieldNode.Object(
            "item",
            ReportFieldNode.Scalar("status"),
            ReportFieldNode.Scalar("cost", "number"),
            ReportFieldNode.Collection(
                "lines",
                ReportFieldNode.Scalar("description"),
                ReportFieldNode.Scalar("total", "number"))),
        ReportFieldNode.Object(
            "meta",
            ReportFieldNode.Scalar("locale")));

    [Fact]
    public void Includes_scalar_leaves_under_objects()
    {
        ReportFieldNode.ConditionPaths(Tree)
            .Should().BeEquivalentTo(["item.status", "item.cost", "meta.locale"]);
    }

    [Fact]
    public void Excludes_collections_and_everything_inside_them()
    {
        var paths = ReportFieldNode.ConditionPaths(Tree);

        paths.Should().NotContain("item.lines");
        paths.Should().NotContain("item.lines.total",
            "the flattener skips collections, so a condition on one would never resolve at render time");
    }

    [Fact]
    public void Excludes_object_nodes_themselves()
    {
        // Only leaves land in the flattened scope; `item` alone is never a value.
        var paths = ReportFieldNode.ConditionPaths(Tree);

        paths.Should().NotContain("item");
        paths.Should().NotContain("meta");
    }

    [Fact]
    public void Respects_the_depth_bound_the_flattener_uses()
    {
        var deep = ReportFieldNode.Object("$root",
            ReportFieldNode.Object("a",
                ReportFieldNode.Object("b",
                    ReportFieldNode.Object("c", ReportFieldNode.Scalar("d")))));

        ReportFieldNode.ConditionPaths(deep, maxDepth: 1).Should().BeEmpty();
        ReportFieldNode.ConditionPaths(deep, maxDepth: 4).Should().Contain("a.b.c.d");
    }

    [Fact]
    public void Empty_tree_yields_no_paths()
    {
        ReportFieldNode.ConditionPaths(ReportFieldNode.Object("$root")).Should().BeEmpty();
    }
}
