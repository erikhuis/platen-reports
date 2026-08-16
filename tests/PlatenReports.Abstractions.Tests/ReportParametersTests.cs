using FluentAssertions;
using PlatenReports.Model;
using Xunit;

namespace PlatenReports.Abstractions.Tests;

public class ReportParametersTests
{
    private static ReportParameters Given(params (string Key, string Value)[] values) =>
        new(values.ToDictionary(v => v.Key, v => v.Value));

    [Fact]
    public void A_blank_value_reads_as_absent()
    {
        Given(("id", "   ")).GetString("id").Should().BeNull();
    }

    [Fact]
    public void A_required_parameter_that_is_missing_is_rejected()
    {
        var act = () => Given().GetRequiredGuid("id");

        act.Should().Throw<ReportParameterException>().WithMessage("*'id' is missing*");
    }

    [Fact]
    public void A_malformed_guid_is_rejected()
    {
        var act = () => Given(("id", "not-a-guid")).GetRequiredGuid("id");

        act.Should().Throw<ReportParameterException>().WithMessage("*must be a GUID*");
    }

    [Fact]
    public void A_decimal_with_a_thousands_separator_is_rejected_rather_than_misread()
    {
        // "1,5" must not parse as 15. A European caller meaning one-and-a-half would
        // otherwise silently get fifteen — the reason this uses Float, not Number.
        var act = () => Given(("qty", "1,5")).GetDecimal("qty");

        act.Should().Throw<ReportParameterException>().WithMessage("*must be a number*");
    }

    [Fact]
    public void A_decimal_parses_with_the_invariant_point()
    {
        Given(("qty", "1.5")).GetDecimal("qty").Should().Be(1.5m);
    }

    [Fact]
    public void A_date_parses_iso_8601()
    {
        Given(("on", "2026-04-03")).GetDate("on").Should().Be(new DateTime(2026, 4, 3));
    }

    [Fact]
    public void A_slashed_date_is_read_month_first_not_rejected()
    {
        // Pinning a known sharp edge rather than the docs' claim of "ISO-8601 only": parsing
        // is invariant, and the invariant short-date pattern is MM/dd. So "03/04/2026" is
        // 4 March everywhere — deterministic, but not what a European caller meant.
        // Tracked as platen-reports#3.
        Given(("on", "03/04/2026")).GetDate("on").Should().Be(new DateTime(2026, 3, 4));
    }

    [Fact]
    public void A_date_that_is_not_a_date_at_all_is_rejected()
    {
        var act = () => Given(("on", "yesterday")).GetDate("on");

        act.Should().Throw<ReportParameterException>().WithMessage("*ISO-8601*");
    }

    [Theory]
    [InlineData("true", true)]
    [InlineData("TRUE", true)]
    [InlineData("false", false)]
    public void A_bool_accepts_only_true_and_false_in_any_casing(string raw, bool expected)
    {
        Given(("flag", raw)).GetBool("flag").Should().Be(expected);
    }

    [Theory]
    [InlineData("1")]
    [InlineData("yes")]
    public void A_bool_refuses_the_other_spellings(string raw)
    {
        // Widening these here would make the wire contract depend on which reader a
        // provider happened to call.
        var act = () => Given(("flag", raw)).GetBool("flag");

        act.Should().Throw<ReportParameterException>().WithMessage("*true or false*");
    }

    [Fact]
    public void Optional_readers_return_null_when_absent()
    {
        var none = Given();

        none.GetGuid("x").Should().BeNull();
        none.GetInt("x").Should().BeNull();
        none.GetDecimal("x").Should().BeNull();
        none.GetDate("x").Should().BeNull();
        none.GetBool("x").Should().BeNull();
    }

    [Fact]
    public void An_int_rejects_a_decimal_value()
    {
        var act = () => Given(("n", "1.5")).GetInt("n");

        act.Should().Throw<ReportParameterException>().WithMessage("*whole number*");
    }
}
