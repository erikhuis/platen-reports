using System.Globalization;
using FluentAssertions;
using Xunit;

namespace PlatenReports.Core.Tests;

/// <summary>
/// Issue #2442 — the engine's hardcoded constants became host-tunable options. Two things need
/// pinning: the defaults still reproduce the old behaviour exactly (so nothing moved when the
/// literals left), and the Scriban limits are still a live sandbox rather than decoration.
/// </summary>
public class ReportingOptionsTests
{
    [Fact]
    public void Defaults_reproduce_the_previously_hardcoded_values()
    {
        // These were literals in ReportTextRenderer and a const on ReportingService. If a default
        // drifts, a host that configures nothing silently changes behaviour — including the
        // security posture below.
        var options = ReportingOptions.Default;

        options.DefaultLocale.Should().Be("en");
        options.TemplateCacheLimit.Should().Be(2000);
        options.ScribanLoopLimit.Should().Be(1000);
        options.ScribanRecursiveLimit.Should().Be(100);
    }

    [Fact]
    public void The_loop_limit_still_trips_on_a_runaway_template()
    {
        // GHSA-24c8-4792-22hx posture: overlay templates are tenant-authored and rendered
        // unattended, so an unbounded loop must not run. A tripped limit degrades to the
        // placeholder, never an exception out of the renderer.
        var runaway = "{{ for i in 1..100000 }}x{{ end }}";

        var rendered = ReportTextRenderer.Render(runaway, new Dictionary<string, object?>());

        rendered.Should().Be(ReportTextRenderer.ErrorPlaceholder);
    }

    [Fact]
    public void A_lowered_loop_limit_trips_earlier()
    {
        // Proves the option is actually wired to Scriban rather than merely stored: this
        // template renders fine on the default limit and must fail on a tighter one.
        var template = "{{ for i in 1..500 }}x{{ end }}";
        var scope = new Dictionary<string, object?>();

        ReportTextRenderer.Render(template, scope)
            .Should().NotBe(ReportTextRenderer.ErrorPlaceholder, "500 iterations is under the 1000 default");

        ReportTextRenderer.Render(template, scope, options: new ReportingOptions { ScribanLoopLimit = 10 })
            .Should().Be(ReportTextRenderer.ErrorPlaceholder);
    }

    [Fact]
    public void Rendering_without_options_matches_rendering_with_the_defaults()
    {
        var scope = new Dictionary<string, object?> { ["name"] = "Pump 42" };

        var implicitDefaults = ReportTextRenderer.Render("{{ name }}", scope);
        var explicitDefaults = ReportTextRenderer.Render(
            "{{ name }}", scope, culture: null, options: ReportingOptions.Default);

        implicitDefaults.Should().Be("Pump 42").And.Be(explicitDefaults);
    }

    [Fact]
    public void Culture_still_drives_number_formatting_alongside_options()
    {
        // Regression guard for the signature change: `culture` and `options` are separate
        // arguments and adding the latter must not have displaced the former.
        var scope = new Dictionary<string, object?> { ["value"] = 1234.5m };

        ReportTextRenderer.Render("{{ value }}", scope, culture: new CultureInfo("nl-NL"))
            .Should().Contain(",", "nl-NL uses a comma decimal separator");
    }

    [Fact]
    public async Task DefaultLocale_from_options_is_used_when_the_request_names_none()
    {
        var renderer = new SpyRenderer();
        var service = ReportingTestHost.Build(renderer, new ReportingOptions { DefaultLocale = "nl" });

        await service.RenderAsync("test-report", new Dictionary<string, string>(), locale: "");

        renderer.LastContext!.Locale.Should().Be("nl");
    }

    [Fact]
    public async Task An_explicit_request_locale_still_wins_over_the_default()
    {
        var renderer = new SpyRenderer();
        var service = ReportingTestHost.Build(renderer, new ReportingOptions { DefaultLocale = "nl" });

        await service.RenderAsync("test-report", new Dictionary<string, string>(), locale: "de");

        renderer.LastContext!.Locale.Should().Be("de");
    }

    [Fact]
    public async Task A_service_built_without_options_falls_back_to_the_defaults()
    {
        var renderer = new SpyRenderer();
        var service = ReportingTestHost.Build(renderer);

        await service.RenderAsync("test-report", new Dictionary<string, string>(), locale: "");

        renderer.LastContext!.Locale.Should().Be("en");
    }
}
