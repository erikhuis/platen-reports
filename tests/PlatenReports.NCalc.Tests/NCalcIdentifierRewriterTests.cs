using FluentAssertions;
using Xunit;

namespace PlatenReports.NCalc.Tests;

/// <summary>
/// Direct cover for the dotted-identifier rewriting.
/// </summary>
/// <remarks>
/// In the origin codebase this helper was shared with a workflow rules engine and was exercised
/// mainly through that engine's own suite, which did not come across. Carrying the copy without
/// carrying its coverage would have left the package's only string-munging code untested, so
/// these are written directly against it rather than inferred through the evaluator.
/// </remarks>
public class NCalcIdentifierRewriterTests
{
    [Theory]
    [InlineData("item.status", "[item.status]")]
    [InlineData("item.status = 'Active'", "[item.status] = 'Active'")]
    [InlineData("a.b.c > 1", "[a.b.c] > 1")]
    [InlineData("_private.field", "[_private.field]")]
    public void Wraps_a_dotted_identifier(string input, string expected) =>
        NCalcIdentifierRewriter.WrapDottedIdentifiers(input).Should().Be(expected);

    [Theory]
    [InlineData("status", "status")]
    [InlineData("Round(cost, 2)", "Round(cost, 2)")]
    [InlineData("1 + 2", "1 + 2")]
    public void Leaves_an_undotted_identifier_alone(string input, string expected) =>
        NCalcIdentifierRewriter.WrapDottedIdentifiers(input).Should().Be(expected);

    [Fact]
    public void Leaves_an_already_bracketed_identifier_alone()
    {
        // Both spellings reach the evaluator — published definitions bracket, authoring UIs do
        // not — so rewriting must be idempotent over its own output.
        NCalcIdentifierRewriter.WrapDottedIdentifiers("[item.status] = 'Active'")
            .Should().Be("[item.status] = 'Active'");

        string once = NCalcIdentifierRewriter.WrapDottedIdentifiers("item.status = 'Active'");
        NCalcIdentifierRewriter.WrapDottedIdentifiers(once).Should().Be(once);
    }

    [Theory]
    [InlineData("'a.b'", "'a.b'")]
    [InlineData("\"a.b\"", "\"a.b\"")]
    [InlineData("item.status = 'a.b'", "[item.status] = 'a.b'")]
    public void Never_rewrites_inside_a_string_literal(string input, string expected) =>
        NCalcIdentifierRewriter.WrapDottedIdentifiers(input).Should().Be(expected);

    [Fact]
    public void Handles_an_escaped_quote_inside_a_literal()
    {
        // The escape walk is what keeps a literal from being closed early — if it were, the rest
        // of the expression would be scanned as code and its dots wrapped.
        NCalcIdentifierRewriter.WrapDottedIdentifiers(@"item.status = 'it\'s'")
            .Should().Be(@"[item.status] = 'it\'s'");
    }

    [Theory]
    [InlineData("1.5 > 1", "1.5 > 1")]
    [InlineData("item.cost > 1.5", "[item.cost] > 1.5")]
    public void Leaves_a_decimal_number_alone(string input, string expected) =>
        NCalcIdentifierRewriter.WrapDottedIdentifiers(input).Should().Be(expected);

    [Fact]
    public void Leaves_an_unterminated_literal_without_looping_or_throwing()
    {
        // Malformed input reaches this helper — Evaluate rewrites before it parses, so the
        // rewriter sees the garbage first and must hand it on for the parser to reject.
        var act = () => NCalcIdentifierRewriter.WrapDottedIdentifiers("'unterminated");
        act.Should().NotThrow();
        act().Should().Be("'unterminated");
    }

    [Fact]
    public void Leaves_an_unterminated_bracket_without_looping_or_throwing()
    {
        var act = () => NCalcIdentifierRewriter.WrapDottedIdentifiers("[item.status");
        act.Should().NotThrow();
        act().Should().Be("[item.status");
    }

    [Fact]
    public void Handles_an_empty_expression() =>
        NCalcIdentifierRewriter.WrapDottedIdentifiers("").Should().BeEmpty();
}
