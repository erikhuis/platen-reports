using System.Globalization;
using FluentAssertions;
using Xunit;

namespace PlatenReports.Core.Tests;

public class ReportPathBinderTests
{
    private static readonly IReadOnlyDictionary<string, object?> Root = new Dictionary<string, object?>
    {
        ["workOrder"] = new Dictionary<string, object?>
        {
            ["number"] = "WO-001",
            ["priority"] = new Dictionary<string, object?> { ["name"] = "High" },
            ["cost"] = 1234.5m,
            ["lines"] = new List<object?>(),
        },
    };

    [Fact]
    public void Resolves_nested_dotted_paths()
    {
        ReportPathBinder.Resolve(Root, "workOrder.number").Should().Be("WO-001");
        ReportPathBinder.Resolve(Root, "workOrder.priority.name").Should().Be("High");
    }

    [Theory]
    [InlineData("workOrder.missing")]
    [InlineData("missing.number")]
    [InlineData("workOrder.number.tooDeep")]
    public void Missing_segments_resolve_to_null_never_throw(string path)
    {
        ReportPathBinder.Resolve(Root, path).Should().BeNull();
    }

    [Fact]
    public void Row_scope_falls_through_to_root_for_header_fields()
    {
        var rowScope = new Dictionary<string, object?> { ["code"] = "ART-1" };

        ReportPathBinder.Resolve(rowScope, Root, "code").Should().Be("ART-1");
        ReportPathBinder.Resolve(rowScope, Root, "workOrder.number").Should().Be("WO-001");
    }

    [Fact]
    public void Row_scope_wins_over_root_on_collision()
    {
        var rowScope = new Dictionary<string, object?>
        {
            ["workOrder"] = new Dictionary<string, object?> { ["number"] = "row-value" },
        };

        ReportPathBinder.Resolve(rowScope, Root, "workOrder.number").Should().Be("row-value");
    }

    [Fact]
    public void Format_applies_dotnet_format_strings_with_culture()
    {
        var value = 1234.5m;
        ReportPathBinder.Format(value, "N2", CultureInfo.GetCultureInfo("en")).Should().Be("1,234.50");
        ReportPathBinder.Format(value, "N2", CultureInfo.GetCultureInfo("nl")).Should().Be("1.234,50");
    }

    [Fact]
    public void Format_handles_null_bool_and_dates()
    {
        var culture = CultureInfo.GetCultureInfo("en");
        ReportPathBinder.Format(null, "N2", culture).Should().BeEmpty();
        ReportPathBinder.Format(true, null, culture).Should().Be("✓");
        ReportPathBinder.Format(new DateTime(2026, 7, 10, 12, 0, 0), "d", culture).Should().Be("7/10/2026");
    }

    [Fact]
    public void Bad_format_string_degrades_to_the_default_rendering_never_throws()
    {
        // Format strings are tenant-authored (overlay setProps); a bad one must not take the
        // report down — it falls back to the unformatted culture-aware rendering.
        var culture = CultureInfo.GetCultureInfo("en");
        ReportPathBinder.Format(1234.5m, "Q9", culture).Should().Be("1234.5");
        var date = new DateTime(2026, 7, 10, 12, 0, 0);
        ReportPathBinder.Format(date, "'unterminated", culture)
            .Should().Be(date.ToString("g", culture), "bad date formats fall back to 'g'");
    }

    [Fact]
    public void Utc_date_times_are_converted_to_the_report_time_zone_before_formatting()
    {
        var culture = CultureInfo.GetCultureInfo("en");
        var amsterdam = TimeZoneInfo.FindSystemTimeZoneById("Europe/Amsterdam");

        // January = CET (UTC+1); July = CEST (UTC+2) — both through the same conversion.
        ReportPathBinder.Format(new DateTime(2026, 1, 10, 12, 0, 0, DateTimeKind.Utc), "HH:mm", culture, amsterdam)
            .Should().Be("13:00");
        ReportPathBinder.Format(new DateTime(2026, 7, 10, 12, 0, 0, DateTimeKind.Utc), "HH:mm", culture, amsterdam)
            .Should().Be("14:00");
        ReportPathBinder.Format(new DateTimeOffset(2026, 1, 10, 12, 0, 0, TimeSpan.Zero), "HH:mm", culture, amsterdam)
            .Should().Be("13:00");
    }

    [Fact]
    public void Non_utc_kinds_and_null_zone_pass_through_unconverted()
    {
        var culture = CultureInfo.GetCultureInfo("en");
        var amsterdam = TimeZoneInfo.FindSystemTimeZoneById("Europe/Amsterdam");

        // Unspecified-kind values (e.g. hand-built test data, DateOnly-ish values) are not
        // silently shifted; without a zone the UTC value prints as-is.
        ReportPathBinder.Format(new DateTime(2026, 1, 10, 12, 0, 0, DateTimeKind.Unspecified), "HH:mm", culture, amsterdam)
            .Should().Be("12:00");
        ReportPathBinder.Format(new DateTime(2026, 1, 10, 12, 0, 0, DateTimeKind.Utc), "HH:mm", culture)
            .Should().Be("12:00");
    }

    [Fact]
    public void FlattenForConditions_emits_dotted_scalar_keys_and_skips_collections()
    {
        var flat = ReportPathBinder.FlattenForConditions(Root);

        flat.Should().ContainKey("workOrder.number").WhoseValue.Should().Be("WO-001");
        flat.Should().ContainKey("workOrder.priority.name");
        flat.Should().NotContainKey("workOrder.lines");
    }
}
