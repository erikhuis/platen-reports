using FluentAssertions;
using Xunit;

namespace PlatenReports.Core.Tests;

/// <summary>
/// The print footer stamps the caller's time zone (meta.generatedAtLocal / meta.timeZone).
/// Unknown or missing ids must fall back to UTC — never throw for a bad browser value.
///
/// Driven through <see cref="ReportingService.RenderAsync"/> since #2442, so these assert what
/// actually reaches the renderer rather than what a helper returns in isolation.
/// </summary>
public class ReportingServiceTimeZoneTests
{
    private static readonly DateTime FixedUtc = new(2026, 7, 14, 15, 30, 45, DateTimeKind.Utc);

    [Theory]
    [InlineData("Europe/Amsterdam")]
    [InlineData("America/New_York")]
    [InlineData("UTC")]
    public async Task Stamps_the_requested_zone_into_meta(string id)
    {
        var meta = await RenderMeta(id);

        meta["timeZone"].Should().Be(id);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Not/AZone")]
    [InlineData("<script>")]
    public async Task Unknown_or_missing_ids_fall_back_to_utc(string? id)
    {
        var meta = await RenderMeta(id);

        meta["timeZone"].Should().Be(TimeZoneInfo.Utc.Id);
    }

    [Fact]
    public async Task Stamps_generatedAt_from_the_injected_clock()
    {
        // The whole reason TimeProvider was injected: this assertion was previously impossible
        // and the print stamp went untested end to end.
        var meta = await RenderMeta("UTC");

        meta["generatedAt"].Should().Be(FixedUtc);
    }

    [Fact]
    public async Task Renders_generatedAtLocal_in_the_callers_zone()
    {
        // 15:30:45Z is 17:30 in Amsterdam in July. Compare against the UTC render rather than
        // pinning a formatted string: the "en" report culture prints 12-hour ("5:30 PM"), so an
        // exact literal would be asserting the culture mapping, not the zone conversion.
        var local = (string)(await RenderMeta("Europe/Amsterdam"))["generatedAtLocal"]!;
        var utc = (string)(await RenderMeta("UTC"))["generatedAtLocal"]!;

        local.Should().NotBe(utc, "the caller's zone must shift the printed stamp");
        local.Should().Contain("5:30");
        utc.Should().Contain("3:30");
    }

    private static async Task<IReadOnlyDictionary<string, object?>> RenderMeta(string? timeZone)
    {
        var renderer = new SpyRenderer();
        await ReportingTestHost
            .Build(renderer, clock: new FixedTimeProvider(FixedUtc))
            .RenderAsync("test-report", new Dictionary<string, string>(), "en",
                timeZone: timeZone);

        return (IReadOnlyDictionary<string, object?>)renderer.LastContext!.Data.Root["meta"]!;
    }
}
