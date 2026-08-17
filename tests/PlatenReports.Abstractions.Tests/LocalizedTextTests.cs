using FluentAssertions;
using PlatenReports.Model;
using Xunit;

namespace PlatenReports.Abstractions.Tests;

public class LocalizedTextTests
{
    [Fact]
    public void A_plain_string_reads_the_same_in_every_locale()
    {
        var text = new LocalizedText("Status");

        text.Resolve("en").Should().Be("Status");
        text.Resolve("nl").Should().Be("Status");
        text.Resolve("zz-ZZ").Should().Be("Status");
    }

    [Fact]
    public void An_exact_locale_match_wins()
    {
        var text = new LocalizedText(new Dictionary<string, string> { ["en"] = "Status", ["nl"] = "Toestand" });

        text.Resolve("nl").Should().Be("Toestand");
    }

    [Fact]
    public void A_full_tag_falls_back_to_its_primary_subtag()
    {
        // Callers pass "nl-NL" while definitions carry two-letter keys.
        var text = new LocalizedText(new Dictionary<string, string> { ["en"] = "Status", ["nl"] = "Toestand" });

        text.Resolve("nl-NL").Should().Be("Toestand");
    }

    [Fact]
    public void An_unknown_locale_falls_back_to_english()
    {
        var text = new LocalizedText(new Dictionary<string, string> { ["en"] = "Status", ["nl"] = "Toestand" });

        text.Resolve("de").Should().Be("Status");
    }

    [Fact]
    public void With_no_english_entry_the_first_value_is_used()
    {
        // A definition author who ships one locale still gets text out, in every locale.
        var text = new LocalizedText(new Dictionary<string, string> { ["nl"] = "Toestand" });

        text.Resolve("de").Should().Be("Toestand");
    }

    [Fact]
    public void An_empty_map_resolves_to_empty_rather_than_throwing()
    {
        var text = new LocalizedText(new Dictionary<string, string>());

        text.Resolve("en").Should().BeEmpty();
    }

    [Fact]
    public void Empty_is_blank_in_every_locale()
    {
        LocalizedText.Empty.Resolve("en").Should().BeEmpty();
        LocalizedText.Empty.Resolve("nl").Should().BeEmpty();
    }
}
