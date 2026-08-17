using FluentAssertions;
using Xunit;

namespace PlatenReports.Core.Tests;

/// <summary>
/// Issue #2190 — the export filename is "{reportKey}-{datetime, with seconds}.{ext}" in the
/// caller's time zone, so re-exporting the same report never collides in a downloads folder.
///
/// Driven through the public <see cref="ReportingService.RenderAsync"/> since #2442. These used
/// to call the internal <c>BuildFileName</c> directly — not by choice, but because
/// <c>DateTime.UtcNow</c> could not be stubbed, so they asserted a helper instead of the
/// behaviour. With <see cref="TimeProvider"/> injected they exercise the real path, which is
/// what the issue actually cares about.
/// </summary>
public class ReportingServiceFileNameTests
{
    private static readonly DateTime FixedUtc = new(2026, 7, 14, 15, 30, 45, DateTimeKind.Utc);

    [Fact]
    public async Task Builds_reportkey_dash_timestamp_with_seconds()
    {
        var result = await Render(timeZone: "UTC");

        result.FileName.Should().Be("test-report-2026-07-14_15-30-45.pdf");
    }

    [Fact]
    public async Task Renders_the_timestamp_in_the_caller_time_zone()
    {
        // 15:30:45Z is 17:30:45 in Amsterdam in July (UTC+2, DST).
        var result = await Render(timeZone: "Europe/Amsterdam");

        result.FileName.Should().Be("test-report-2026-07-14_17-30-45.pdf");
    }

    [Fact]
    public async Task Crosses_the_date_boundary_in_the_caller_zone()
    {
        // 23:15:05Z is the next day in Amsterdam — the filename must follow the caller, not UTC.
        var result = await Render(
            timeZone: "Europe/Amsterdam", nowUtc: new DateTime(2026, 7, 14, 23, 15, 5, DateTimeKind.Utc));

        result.FileName.Should().Be("test-report-2026-07-15_01-15-05.pdf");
    }

    [Fact]
    public async Task Includes_seconds_so_rapid_reexports_do_not_collide()
    {
        var first = await Render(nowUtc: FixedUtc);
        var second = await Render(nowUtc: FixedUtc.AddSeconds(1));

        first.FileName.Should().NotBe(second.FileName);
    }

    [Fact]
    public async Task Uses_the_renderers_extension_and_content_type_rather_than_assuming_pdf()
    {
        // #2440 — the orchestrator asks the renderer, so a future HTML or XLSX renderer needs
        // no change here.
        var result = await Render(renderer: new SpyRenderer("application/vnd.ms-excel", "xlsx"));

        result.FileName.Should().EndWith(".xlsx");
        result.ContentType.Should().Be("application/vnd.ms-excel");
    }

    [Fact]
    public async Task Unknown_time_zone_falls_back_to_utc_without_throwing()
    {
        // A browser can send anything; a bad zone must not fail the print.
        var result = await Render(timeZone: "Not/AZone");

        result.FileName.Should().Be("test-report-2026-07-14_15-30-45.pdf");
    }

    [Fact]
    public void Tolerates_an_extension_that_already_has_a_dot()
    {
        // Not reachable through RenderAsync — no shipped renderer returns a dotted extension —
        // so this one stays on the helper, where the normalisation actually lives.
        ReportingService.BuildFileName("asset-list", TimeZoneInfo.Utc, FixedUtc, ".pdf")
            .Should().Be("asset-list-2026-07-14_15-30-45.pdf");
    }

    private static Task<ReportRenderResult> Render(
        string? timeZone = null, DateTime? nowUtc = null, SpyRenderer? renderer = null) =>
        ReportingTestHost
            .Build(renderer ?? new SpyRenderer(), clock: new FixedTimeProvider(nowUtc ?? FixedUtc))
            .RenderAsync("test-report", new Dictionary<string, string>(), "en",
                timeZone: timeZone);
}
