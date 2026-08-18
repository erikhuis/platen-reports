using FluentAssertions;
using Xunit;

namespace PlatenReports.NCalc.Tests;

/// <summary>
/// The narrow condition port. Two contracts matter more than the rest and are covered hardest
/// here: <b>null-as-false</b> (a null operand hides the element, it does not error) and
/// <b>never throws for content reasons</b> (a printed document must not fail because one
/// element's condition was wrong).
/// </summary>
public class NCalcReportConditionEvaluatorTests
{
    private static readonly NCalcReportConditionEvaluator Evaluator = new();

    private static Dictionary<string, object?> Scope() => new()
    {
        ["item.status"] = "Active",
        ["item.cost"] = 1250.75m,
        ["item.isCritical"] = true,
        ["item.retiredAt"] = null,
        ["meta.locale"] = "en",
    };

    // ─── Evaluate ─────────────────────────────────────────────────────────────

    [Fact]
    public void Evaluate_true_condition_shows_the_element()
    {
        var result = Evaluator.Evaluate("item.status = 'Active'", Scope());

        result.Visible.Should().BeTrue();
        result.Error.Should().BeNull();
    }

    [Fact]
    public void Evaluate_false_condition_hides_without_an_error()
    {
        // A condition that simply evaluated false is not a failure — no error, nothing to log.
        var result = Evaluator.Evaluate("item.status = 'Retired'", Scope());

        result.Visible.Should().BeFalse();
        result.Error.Should().BeNull();
    }

    [Fact]
    public void Evaluate_null_operand_hides_the_element_and_is_not_an_error()
    {
        // Null-as-false. Reports print on incomplete data constantly; a null must not be
        // reported as a broken condition.
        var result = Evaluator.Evaluate("item.retiredAt = '2020-01-01'", Scope());

        result.Visible.Should().BeFalse();
        result.Error.Should().BeNull("a null operand is the documented outcome, not a failure");
    }

    [Fact]
    public void Evaluate_unknown_field_hides_the_element_with_an_error()
    {
        var result = Evaluator.Evaluate("item.nope = 1", Scope());

        result.Visible.Should().BeFalse();
        result.Error.Should().Contain("item.nope");
    }

    [Fact]
    public void Evaluate_disallowed_function_hides_the_element_with_an_error()
    {
        var result = Evaluator.Evaluate("Secret('x')", Scope());

        result.Visible.Should().BeFalse();
        result.Error.Should().Contain("Secret");
    }

    [Fact]
    public void Evaluate_treats_a_non_boolean_result_as_hidden()
    {
        var result = Evaluator.Evaluate("item.cost", Scope());

        result.Visible.Should().BeFalse();
    }

    [Fact]
    public void Evaluate_empty_expression_shows_the_element()
    {
        Evaluator.Evaluate("", Scope()).Visible.Should().BeTrue();
        Evaluator.Evaluate("   ", Scope()).Visible.Should().BeTrue();
    }

    [Theory]
    [InlineData("item.status = ")]           // truncated
    [InlineData("((item.cost > 1)")]         // unbalanced
    [InlineData("1 / 0")]                    // arithmetic fault
    [InlineData("@@@")]                      // garbage
    [InlineData("'unterminated")]            // bad literal
    public void Evaluate_never_throws_for_content_reasons(string expression)
    {
        var act = () => Evaluator.Evaluate(expression, Scope());

        act.Should().NotThrow();
        act().Visible.Should().BeFalse("anything the evaluator cannot make sense of hides the element");
    }

    [Fact]
    public void Evaluate_supports_the_string_helpers_in_the_allowlist()
    {
        Evaluator.Evaluate("StartsWith(item.status, 'Act')", Scope()).Visible.Should().BeTrue();
        Evaluator.Evaluate("EndsWith(item.status, 'ive')", Scope()).Visible.Should().BeTrue();
        Evaluator.Evaluate("Contains(item.status, 'cti')", Scope()).Visible.Should().BeTrue();
    }

    [Fact]
    public void Evaluate_accepts_both_bare_and_bracketed_dotted_paths()
    {
        // Published definitions tend to use the bracketed form; an authoring UI emits the bare one.
        Evaluator.Evaluate("[item.isCritical] = true", Scope()).Visible.Should().BeTrue();
        Evaluator.Evaluate("item.isCritical = true", Scope()).Visible.Should().BeTrue();
    }

    // ─── Validate ─────────────────────────────────────────────────────────────

    private static readonly IReadOnlySet<string> KnownPaths =
        new HashSet<string>(StringComparer.Ordinal) { "item.status", "item.cost", "meta.locale" };

    [Fact]
    public void Validate_accepts_a_well_formed_expression_over_known_paths() => Evaluator.Validate("item.status = 'Active' && item.cost > 10", KnownPaths).Should().BeEmpty();

    [Fact]
    public void Validate_rejects_an_unknown_field_path()
    {
        var errors = Evaluator.Validate("item.nope = 'x'", KnownPaths);

        errors.Should().ContainSingle().Which.Should().Contain("item.nope");
    }

    [Fact]
    public void Validate_rejects_an_expression_that_does_not_parse()
    {
        Evaluator.Validate("item.status = ", KnownPaths)
            .Should().ContainSingle().Which.Should().Contain("does not parse");
    }

    [Fact]
    public void Validate_rejects_a_function_outside_the_allowlist()
    {
        Evaluator.Validate("Secret(item.status)", KnownPaths)
            .Should().ContainSingle().Which.Should().Contain("Secret");
    }

    [Fact]
    public void Validate_reports_every_problem_not_just_the_first()
    {
        // An authoring UI shows these together; fixing errors one round-trip at a time is
        // miserable, so the walk collects them all.
        var errors = Evaluator.Validate("item.nope = 1 && item.alsoNope = 2", KnownPaths);

        errors.Should().HaveCount(2);
        errors.Should().Contain(e => e.Contains("item.nope"));
        errors.Should().Contain(e => e.Contains("item.alsoNope"));
    }

    [Fact]
    public void Validate_without_known_paths_skips_field_checking_but_still_checks_syntax()
    {
        Evaluator.Validate("anything.at.all = 1").Should().BeEmpty();
        Evaluator.Validate("still.broken = ").Should().ContainSingle();
        Evaluator.Validate("Secret(1)").Should().ContainSingle();
    }

    [Fact]
    public void Validate_accepts_an_empty_expression()
    {
        // No visibleIf means "always visible"; there is nothing to validate.
        Evaluator.Validate("", KnownPaths).Should().BeEmpty();
        Evaluator.Validate("   ", KnownPaths).Should().BeEmpty();
    }

    [Fact]
    public void Validate_accepts_the_allowlisted_functions()
    {
        Evaluator.Validate("StartsWith(item.status, 'A')", KnownPaths).Should().BeEmpty();
        Evaluator.Validate("Round(item.cost, 2) > 1", KnownPaths).Should().BeEmpty();
    }

    [Fact]
    public void Validate_accepts_a_well_formed_in_list() => Evaluator.Validate("item.status in ('Active', 'Retired')", KnownPaths).Should().BeEmpty();

    [Fact]
    public void Validate_looks_inside_an_in_list()
    {
        // `x in (a, b)` parses to a BinaryExpression whose right side is a LogicalExpressionList.
        // Without a case for that node the walk stops at it, and an unknown field hidden in the
        // list sails through authoring-time validation and silently hides the element on every
        // print — exactly the failure this validation exists to prevent.
        Evaluator.Validate("item.status in ('Active', item.nope)", KnownPaths)
            .Should().ContainSingle().Which.Should().Contain("item.nope");
    }

    [Fact]
    public void Validate_rejects_a_disallowed_function_inside_an_in_list()
    {
        Evaluator.Validate("item.status in ('Active', Secret(1))", KnownPaths)
            .Should().ContainSingle().Which.Should().Contain("Secret");
    }

    [Theory]
    [InlineData("and")]
    [InlineData("or")]
    public void Validate_rejects_operator_keywords_called_as_functions(string name)
    {
        // and/or are NCalc *operators* (&&, ||), not callable functions. Allowlisting them let
        // `and(a, b)` pass validation and then die at render with FunctionNotFound — validation
        // blessing an expression that can never evaluate is worse than not checking it.
        Evaluator.Validate($"{name}(item.status, item.cost)", KnownPaths)
            .Should().ContainSingle().Which.Should().Contain(name);
    }

    [Fact]
    public void Not_is_a_unary_operator_and_is_accepted_in_both_spellings()
    {
        // `not` is unlike and/or: NCalc parses `not(x)` as the unary operator applied to a
        // parenthesised expression, not as a function call, so it never reaches the allowlist
        // and evaluates fine. Validate must not reject it.
        Evaluator.Validate("not(item.isCritical)", KnownPaths.Append("item.isCritical").ToHashSet())
            .Should().BeEmpty();

        Evaluator.Evaluate("not(item.isCritical)", Scope()).Visible.Should().BeFalse();
        Evaluator.Evaluate("!(item.isCritical)", Scope()).Visible.Should().BeFalse();
        Evaluator.Evaluate("not(item.status = 'Retired')", Scope()).Visible.Should().BeTrue();
    }

    [Fact]
    public void Validate_still_accepts_the_operator_forms()
    {
        // The operators themselves are untouched — only the function-call spelling is rejected.
        Evaluator.Validate("!(item.status = 'Active')", KnownPaths).Should().BeEmpty();
        Evaluator.Validate("item.status = 'Active' && item.cost > 1", KnownPaths).Should().BeEmpty();
        Evaluator.Validate("item.status = 'Active' || item.cost > 1", KnownPaths).Should().BeEmpty();
    }

    [Fact]
    public void Evaluate_agrees_with_Validate_about_in_lists()
    {
        // Whatever Validate accepts must actually evaluate, or the check is decorative.
        Evaluator.Evaluate("item.status in ('Active', 'Retired')", Scope()).Visible.Should().BeTrue();
        Evaluator.Evaluate("item.status in ('Retired')", Scope()).Visible.Should().BeFalse();
    }

    // ─── Unknown paths: the pin ───────────────────────────────────────────────

    /// <summary>
    /// An unknown path is the one place where a slip would silently change what gets printed.
    /// A throw would break the whole document; a <see langword="true"/> would leak an element
    /// onto a page that should not carry it. Both directions are pinned here, including the
    /// short-circuiting operators, where "the other side was true" is the plausible way a
    /// rewrite would start returning visible.
    /// </summary>
    [Theory]
    [InlineData("item.nope")]
    [InlineData("item.nope = 1")]
    [InlineData("item.nope != 1")]
    [InlineData("!(item.nope)")]
    [InlineData("not(item.nope = 1)")]
    [InlineData("item.nope || true")]
    [InlineData("item.nope && true")]
    [InlineData("true && item.nope")]
    [InlineData("if(item.nope, true, true)")]
    [InlineData("item.nope in ('Active')")]
    public void Evaluate_an_unknown_path_always_hides_and_never_throws(string expression)
    {
        var act = () => Evaluator.Evaluate(expression, Scope());

        act.Should().NotThrow("a printed document must never fail because one condition was wrong");
        act().Visible.Should().BeFalse("an unknown path must never resolve to visible");
    }

    [Fact]
    public void Evaluate_an_unknown_path_names_the_path_in_the_error()
    {
        // Distinguishes "unknown field" from "evaluated false", which the caller logs differently.
        var result = Evaluator.Evaluate("item.nope = 1", Scope());

        result.Error.Should().NotBeNull().And.Contain("item.nope");
    }

    [Theory]
    [InlineData("true || item.nope")]
    [InlineData("item.status = 'Active' || item.nope = 1")]
    public void Evaluate_short_circuits_past_an_unknown_path_on_the_unreached_side(string expression)
    {
        // Documented, not accidental: `||` stops at a true left operand, so the right side is
        // never evaluated and its unknown path never reported. The result is what boolean logic
        // says it is — the unknown path took no part in it.
        //
        // The asymmetry is worth knowing when reading a rendered document: `true || item.nope`
        // shows the element, while `item.nope || true` hides it with an "unknown field" error,
        // because there the unknown operand *is* reached. Authoring-time Validate catches the
        // unknown path in both spellings, which is where it should be caught.
        var result = Evaluator.Evaluate(expression, Scope());

        result.Visible.Should().BeTrue();
        result.Error.Should().BeNull();
    }

    [Fact]
    public void Validate_reports_an_unknown_path_even_where_Evaluate_would_short_circuit_past_it()
    {
        // The safety net for the case above: the walk is static, so it does not care which side
        // an operator would have reached.
        Evaluator.Validate("true || item.nope", KnownPaths)
            .Should().ContainSingle().Which.Should().Contain("item.nope");
    }

    [Fact]
    public void Evaluate_a_known_path_holding_null_is_hidden_but_carries_no_error()
    {
        // The counterpart: absent from the scope is an error, present-but-null is not.
        var result = Evaluator.Evaluate("item.retiredAt = 'x'", Scope());

        result.Visible.Should().BeFalse();
        result.Error.Should().BeNull();
    }
}
