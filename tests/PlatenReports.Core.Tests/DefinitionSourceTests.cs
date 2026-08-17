using FluentAssertions;
using PlatenReports.Definitions;
using PlatenReports.Model;
using Xunit;

namespace PlatenReports.Core.Tests;

/// <summary>
/// The definition sources, and the loading rules they share.
/// </summary>
/// <remarks>
/// The origin codebase had one store that hardcoded its own assembly and resource prefix in a
/// static field, which made it useful to exactly one application. These assert the property that
/// replaced it: <b>the caller supplies where definitions come from</b>.
/// </remarks>
public class DefinitionSourceTests
{
    private static string Definition(string key, string version) => $$"""
    {
      "schemaVersion": 1, "key": "{{key}}", "version": "{{version}}",
      "title": "Test", "dataSource": "test-source",
      "body": [ { "id": "a", "type": "text", "text": "content" } ]
    }
    """;

    // ── InMemory ────────────────────────────────────────────────────────────

    [Fact]
    public void InMemory_serves_what_it_was_given()
    {
        var source = new InMemoryDefinitionSource(Definition("a", "1.0.0"), Definition("b", "1.0.0"));

        source.ListReports().Select(d => d.Key).Should().Equal("a", "b");
        source.Get("a")!.Version.Should().Be("1.0.0");
        source.Get("nope").Should().BeNull();
    }

    [Fact]
    public void Keys_match_case_insensitively()
    {
        var source = new InMemoryDefinitionSource(Definition("asset-list", "1.0.0"));

        source.Get("ASSET-LIST").Should().NotBeNull();
    }

    [Fact]
    public void The_highest_version_of_a_key_wins()
    {
        // Publishing a new revision is adding the file; the old one may stay.
        var source = new InMemoryDefinitionSource(
            Definition("r", "1.0.0"), Definition("r", "2.3.0"), Definition("r", "2.1.0"));

        source.Get("r")!.Version.Should().Be("2.3.0");
        source.ListReports().Should().HaveCount(1);
    }

    [Fact]
    public void An_invalid_document_fails_where_it_was_supplied()
    {
        // Fail fast: an invalid published definition is a build defect, not a runtime condition.
        var act = () => new InMemoryDefinitionSource("""{ "schemaVersion": 1 }""");

        act.Should().Throw<ReportValidationException>();
    }

    [Fact]
    public void A_non_parseable_version_is_rejected_with_its_origin_named()
    {
        var act = () => new InMemoryDefinitionSource(Definition("r", "not-a-version"));

        act.Should().Throw<InvalidOperationException>()
            .WithMessage("*in-memory document 0*not-a-version*");
    }

    [Fact]
    public void ListReports_is_ordered_by_key()
    {
        var source = new InMemoryDefinitionSource(
            Definition("zebra", "1.0.0"), Definition("alpha", "1.0.0"), Definition("middle", "1.0.0"));

        source.ListReports().Select(d => d.Key).Should().Equal("alpha", "middle", "zebra");
    }

    [Fact]
    public void CloneDocument_hands_back_an_independent_copy()
    {
        // Sources may hand the same instance to every caller, so the merger must clone first.
        var source = new InMemoryDefinitionSource(Definition("r", "1.0.0"));
        var definition = source.Get("r")!;

        var clone = definition.CloneDocument();
        clone["key"] = "mutated";

        definition.Document["key"]!.GetValue<string>().Should().Be("r");
    }

    // ── Directory ───────────────────────────────────────────────────────────

    [Fact]
    public void Directory_loads_json_files_from_the_path_it_was_given()
    {
        var path = Path.Combine(Path.GetTempPath(), $"platen-defs-{Guid.NewGuid():N}");
        Directory.CreateDirectory(path);
        try
        {
            File.WriteAllText(Path.Combine(path, "a.1.0.0.json"), Definition("a", "1.0.0"));
            File.WriteAllText(Path.Combine(path, "a.2.0.0.json"), Definition("a", "2.0.0"));
            File.WriteAllText(Path.Combine(path, "notes.txt"), "ignored");

            var source = new DirectoryDefinitionSource(path);

            source.ListReports().Should().HaveCount(1);
            source.Get("a")!.Version.Should().Be("2.0.0");
        }
        finally
        {
            Directory.Delete(path, recursive: true);
        }
    }

    [Fact]
    public void Directory_reports_a_missing_path_rather_than_serving_nothing()
    {
        // Silently serving an empty catalogue would look like "this host has no reports".
        var source = new DirectoryDefinitionSource(
            Path.Combine(Path.GetTempPath(), $"platen-missing-{Guid.NewGuid():N}"));

        var act = () => source.ListReports();

        act.Should().Throw<DirectoryNotFoundException>();
    }

    // ── Embedded resources ──────────────────────────────────────────────────

    [Fact]
    public void Embedded_takes_the_assembly_and_prefix_from_its_caller()
    {
        // The property this abstraction exists for: nothing here is hardcoded.
        var source = new EmbeddedResourceDefinitionSource(
            typeof(DefinitionSourceTests).Assembly, "PlatenReports.Core.Tests.TestDefinitions.");

        source.ListReports().Select(d => d.Key).Should().Equal("embedded-report");
        source.Get("embedded-report")!.Version.Should().Be("1.2.0");
    }

    [Fact]
    public void Embedded_finds_nothing_under_a_prefix_that_matches_no_resource()
    {
        var source = new EmbeddedResourceDefinitionSource(
            typeof(DefinitionSourceTests).Assembly, "Nothing.Lives.Here.");

        source.ListReports().Should().BeEmpty();
        source.Get("embedded-report").Should().BeNull();
    }

    [Fact]
    public void Embedded_rejects_a_null_assembly_or_blank_prefix()
    {
        var nullAssembly = () => new EmbeddedResourceDefinitionSource(null!, "X.");
        var blankPrefix = () => new EmbeddedResourceDefinitionSource(typeof(DefinitionSourceTests).Assembly, "  ");

        nullAssembly.Should().Throw<ArgumentNullException>();
        blankPrefix.Should().Throw<ArgumentException>();
    }

    // ── Composite ───────────────────────────────────────────────────────────

    [Fact]
    public void Composite_lets_an_earlier_source_shadow_a_later_one()
    {
        // The point of the composite: a deployment override beats the published definition,
        // even when the override is an OLDER version. Precedence is positional, not by version.
        var overrides = new InMemoryDefinitionSource(Definition("r", "1.0.0"));
        var published = new InMemoryDefinitionSource(Definition("r", "9.9.9"));

        var composite = new CompositeDefinitionSource(overrides, published);

        composite.Get("r")!.Version.Should().Be("1.0.0");
        composite.ListReports().Should().HaveCount(1);
    }

    [Fact]
    public void Composite_unions_keys_across_its_sources()
    {
        var composite = new CompositeDefinitionSource(
            new InMemoryDefinitionSource(Definition("a", "1.0.0")),
            new InMemoryDefinitionSource(Definition("b", "1.0.0")));

        composite.ListReports().Select(d => d.Key).Should().Equal("a", "b");
    }

    [Fact]
    public void Composite_with_no_sources_is_empty_rather_than_broken()
    {
        var composite = new CompositeDefinitionSource();

        composite.ListReports().Should().BeEmpty();
        composite.Get("anything").Should().BeNull();
    }
}
