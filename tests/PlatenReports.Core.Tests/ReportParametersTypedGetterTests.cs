using FluentAssertions;
using PlatenReports.Model;
using Xunit;

namespace PlatenReports.Core.Tests;

/// <summary>
/// Issue #2442 — <c>ReportDefinitionParser</c> has always accepted
/// <c>guid|string|int|decimal|date|bool</c> parameter types, but <see cref="ReportParameters"/>
/// only exposed the guid and string readers, so a definition could declare an <c>int</c> no
/// provider could read type-safely.
///
/// Two contracts matter beyond "it parses": every malformed value raises
/// <see cref="ReportParameterException"/> (which the API maps to 400, never a 500), and parsing
/// is <b>InvariantCulture</b> — these are wire values off a query string, so a server in a
/// comma-decimal locale must read "1234.56" the same way as one in en-US.
/// </summary>
public class ReportParametersTypedGetterTests
{
    private static ReportParameters With(string name, string value) =>
        new(new Dictionary<string, string> { [name] = value });

    private static readonly ReportParameters Empty = ReportParameters.Empty;

    // ─── int ──────────────────────────────────────────────────────────────────

    [Fact]
    public void GetInt_parses_a_whole_number() => With("n", "42").GetInt("n").Should().Be(42);

    [Fact]
    public void GetInt_parses_a_negative() => With("n", "-7").GetInt("n").Should().Be(-7);

    [Fact]
    public void GetInt_returns_null_when_absent() => Empty.GetInt("n").Should().BeNull();

    [Theory]
    [InlineData("4.5")]
    [InlineData("abc")]
    [InlineData("99999999999999999999")]
    public void GetInt_rejects_malformed_input(string raw) =>
        FluentActions.Invoking(() => With("n", raw).GetInt("n"))
            .Should().Throw<ReportParameterException>();

    [Fact]
    public void GetRequiredInt_throws_when_absent() =>
        FluentActions.Invoking(() => Empty.GetRequiredInt("n"))
            .Should().Throw<ReportParameterException>().WithMessage("*missing*");

    // ─── decimal ──────────────────────────────────────────────────────────────

    [Fact]
    public void GetDecimal_parses_an_invariant_decimal() =>
        With("d", "1234.56").GetDecimal("d").Should().Be(1234.56m);

    [Fact]
    public void GetDecimal_reads_a_dot_decimal_regardless_of_the_ambient_locale()
    {
        // The guard against a comma-decimal server silently reading 1234.56 as 123456.
        var previous = Thread.CurrentThread.CurrentCulture;
        try
        {
            Thread.CurrentThread.CurrentCulture = new System.Globalization.CultureInfo("nl-NL");
            With("d", "1234.56").GetDecimal("d").Should().Be(1234.56m);
        }
        finally
        {
            Thread.CurrentThread.CurrentCulture = previous;
        }
    }

    [Fact]
    public void GetDecimal_returns_null_when_absent() => Empty.GetDecimal("d").Should().BeNull();

    [Theory]
    [InlineData("1.2.3")]
    [InlineData("abc")]
    public void GetDecimal_rejects_malformed_input(string raw) =>
        FluentActions.Invoking(() => With("d", raw).GetDecimal("d"))
            .Should().Throw<ReportParameterException>();

    [Theory]
    [InlineData("1,5")]
    [InlineData("1,234.56")]
    public void GetDecimal_rejects_thousands_separators_rather_than_misreading_them(string raw)
    {
        // NumberStyles.Number would allow the separator, so invariant parsing reads "1,5" as
        // FIFTEEN — a European user meaning one-and-a-half silently gets 15. NumberStyles.Float
        // rejects it instead, which is the only safe reading for a wire value.
        FluentActions.Invoking(() => With("d", raw).GetDecimal("d"))
            .Should().Throw<ReportParameterException>();
    }

    [Fact]
    public void GetRequiredDecimal_throws_when_absent() =>
        FluentActions.Invoking(() => Empty.GetRequiredDecimal("d"))
            .Should().Throw<ReportParameterException>().WithMessage("*missing*");

    // ─── date ─────────────────────────────────────────────────────────────────

    [Fact]
    public void GetDate_parses_a_plain_iso_date() =>
        With("from", "2026-07-14").GetDate("from").Should().Be(new DateTime(2026, 7, 14));

    [Fact]
    public void GetDate_parses_a_round_trip_timestamp() =>
        With("from", "2026-07-14T15:30:45Z").GetDate("from")!.Value.ToUniversalTime()
            .Should().Be(new DateTime(2026, 7, 14, 15, 30, 45, DateTimeKind.Utc));

    [Fact]
    public void GetDate_returns_null_when_absent() => Empty.GetDate("from").Should().BeNull();

    [Theory]
    [InlineData("14/07/2026")] // ambiguous day-first — rejected rather than guessed
    [InlineData("not-a-date")]
    [InlineData("2026-13-01")]
    public void GetDate_rejects_malformed_input(string raw) =>
        FluentActions.Invoking(() => With("from", raw).GetDate("from"))
            .Should().Throw<ReportParameterException>();

    [Fact]
    public void GetRequiredDate_throws_when_absent() =>
        FluentActions.Invoking(() => Empty.GetRequiredDate("from"))
            .Should().Throw<ReportParameterException>().WithMessage("*missing*");

    // ─── bool ─────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("true", true)]
    [InlineData("false", false)]
    [InlineData("TRUE", true)]
    [InlineData("False", false)]
    public void GetBool_parses_both_spellings_case_insensitively(string raw, bool expected) =>
        With("flag", raw).GetBool("flag").Should().Be(expected);

    [Fact]
    public void GetBool_returns_null_when_absent() => Empty.GetBool("flag").Should().BeNull();

    [Theory]
    [InlineData("1")]
    [InlineData("yes")]
    [InlineData("on")]
    public void GetBool_rejects_spellings_the_schema_does_not_promise(string raw) =>
        FluentActions.Invoking(() => With("flag", raw).GetBool("flag"))
            .Should().Throw<ReportParameterException>();

    [Fact]
    public void GetRequiredBool_throws_when_absent() =>
        FluentActions.Invoking(() => Empty.GetRequiredBool("flag"))
            .Should().Throw<ReportParameterException>().WithMessage("*missing*");

    // ─── coverage of the declared type set ────────────────────────────────────

    [Fact]
    public void Every_declared_parameter_type_has_a_reader()
    {
        // ReportDefinitionParser.KnownParameterTypes is guid|string|int|decimal|date|bool.
        // If a type is added there without a getter here, a definition can declare something no
        // provider can read — which is exactly the gap this issue closed.
        var readers = typeof(ReportParameters).GetMethods().Select(m => m.Name).ToHashSet();

        readers.Should().Contain(["GetString", "GetGuid", "GetRequiredGuid"]);
        readers.Should().Contain(["GetInt", "GetRequiredInt"]);
        readers.Should().Contain(["GetDecimal", "GetRequiredDecimal"]);
        readers.Should().Contain(["GetDate", "GetRequiredDate"]);
        readers.Should().Contain(["GetBool", "GetRequiredBool"]);
    }

    [Fact]
    public void Whitespace_only_values_read_as_absent()
    {
        // GetString already treats whitespace as missing; the typed readers inherit that rather
        // than each deciding for itself.
        With("n", "   ").GetInt("n").Should().BeNull();
        With("d", "   ").GetDecimal("d").Should().BeNull();
        With("from", "   ").GetDate("from").Should().BeNull();
        With("flag", "   ").GetBool("flag").Should().BeNull();
    }
}
