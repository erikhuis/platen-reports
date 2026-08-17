using FluentAssertions;
using PlatenReports.Model;
using Xunit;

namespace PlatenReports.Core.Tests;

public class ReportDefinitionParserTests
{
    private const string MinimalValid = """
    {
      "schemaVersion": 1,
      "key": "test",
      "version": "1.0.0",
      "title": { "en": "Test report", "nl": "Testrapport" },
      "dataSource": "test",
      "body": [
        { "id": "a", "type": "text", "text": "Hello" }
      ]
    }
    """;

    [Fact]
    public void Parses_minimal_valid_definition()
    {
        var model = ReportDefinitionParser.Parse(MinimalValid);

        model.Key.Should().Be("test");
        model.Body.Should().ContainSingle().Which.Should().BeOfType<TextElement>();
        model.Title.Resolve("nl").Should().Be("Testrapport");
        model.Title.Resolve("de").Should().Be("Test report", "unknown locales fall back to en");
    }

    [Fact]
    public void Rejects_invalid_json()
    {
        var act = () => ReportDefinitionParser.Parse("{ not json");
        act.Should().Throw<ReportValidationException>().Which.Errors.Should().ContainSingle(
            e => e.Contains("not valid JSON"));
    }

    [Fact]
    public void The_supported_schema_versions_come_from_the_engine_not_a_hardcoded_constant()
    {
        // The origin compared a `const int` with `!=`, which makes a supported RANGE
        // unrepresentable and turns every format bump into a hard break for stored documents.
        // The parser now answers from PlatenReportsInfo, and says what it does support.
        var unsupported = """{ "schemaVersion": 99, "key": "k", "version": "1.0.0", "dataSource": "d" }""";

        var act = () => ReportDefinitionParser.Parse(unsupported);

        var errors = act.Should().Throw<ReportValidationException>().Which.Errors;
        errors.Should().ContainSingle(e => e.Contains("schemaVersion") && e.Contains("99"));
        errors.Should().ContainSingle(e => e.Contains(
            string.Join(", ", PlatenReportsInfo.SupportedSchemaVersions.Order())));
    }

    [Fact]
    public void Every_supported_schema_version_actually_parses()
    {
        // Guards the pair: if the set grows, the parser must accept the new value too.
        foreach (var version in PlatenReportsInfo.SupportedSchemaVersions)
        {
            var json = $$"""
            {
              "schemaVersion": {{version}}, "key": "k", "version": "1.0.0", "dataSource": "d",
              "title": "T", "body": [ { "id": "a", "type": "text", "text": "x" } ]
            }
            """;

            var act = () => ReportDefinitionParser.Parse(json);

            act.Should().NotThrow($"schemaVersion {version} is declared supported");
        }
    }

    [Theory]
    [InlineData("""{ "schemaVersion": 2, "key": "k", "version": "1.0.0", "dataSource": "d" }""", "schemaVersion")]
    [InlineData("""{ "schemaVersion": 1, "version": "1.0.0", "dataSource": "d" }""", "'key' is required")]
    [InlineData("""{ "schemaVersion": 1, "key": "k", "version": "1.0.0" }""", "'dataSource' is required")]
    public void Rejects_missing_or_wrong_top_level_fields(string json, string expectedError)
    {
        var act = () => ReportDefinitionParser.Parse(json);
        act.Should().Throw<ReportValidationException>()
            .Which.Errors.Should().Contain(e => e.Contains(expectedError));
    }

    [Fact]
    public void Rejects_missing_and_duplicate_element_ids()
    {
        var act = () => ReportDefinitionParser.Parse("""
        {
          "schemaVersion": 1, "key": "k", "version": "1.0.0", "dataSource": "d",
          "body": [
            { "type": "text", "text": "no id" },
            { "id": "dup", "type": "text", "text": "a" },
            { "id": "dup", "type": "text", "text": "b" }
          ]
        }
        """);

        var errors = act.Should().Throw<ReportValidationException>().Which.Errors;
        errors.Should().Contain(e => e.Contains("missing required 'id'"));
        errors.Should().Contain(e => e.Contains("duplicate element id 'dup'"));
    }

    [Fact]
    public void Rejects_unknown_element_type_and_pageNumber_in_body()
    {
        var act = () => ReportDefinitionParser.Parse("""
        {
          "schemaVersion": 1, "key": "k", "version": "1.0.0", "dataSource": "d",
          "body": [
            { "id": "a", "type": "hologram" },
            { "id": "b", "type": "pageNumber" }
          ]
        }
        """);

        var errors = act.Should().Throw<ReportValidationException>().Which.Errors;
        errors.Should().Contain(e => e.Contains("unknown element type 'hologram'"));
        errors.Should().Contain(e => e.Contains("only allowed inside pageHeader/pageFooter"));
    }

    [Fact]
    public void Rejects_table_without_bind_or_columns_and_bad_totals()
    {
        var act = () => ReportDefinitionParser.Parse("""
        {
          "schemaVersion": 1, "key": "k", "version": "1.0.0", "dataSource": "d",
          "body": [
            { "id": "t", "type": "table",
              "columns": [ { "id": "c1", "header": "H", "path": "p" } ],
              "totals": [ { "columnId": "nope", "aggregate": "avg" } ] }
          ]
        }
        """);

        var errors = act.Should().Throw<ReportValidationException>().Which.Errors;
        errors.Should().Contain(e => e.Contains("'bind' is required"));
        errors.Should().Contain(e => e.Contains("'columnId' must reference a column"));
        errors.Should().Contain(e => e.Contains("'aggregate' must be 'sum' or 'count'"));
    }

    [Fact]
    public void GroupTotals_require_groupBy_and_a_known_column()
    {
        var act = () => ReportDefinitionParser.Parse("""
        {
          "schemaVersion": 1, "key": "k", "version": "1.0.0", "dataSource": "d",
          "body": [
            { "id": "t", "type": "table", "bind": "items",
              "columns": [ { "id": "c1", "header": "H", "path": "p" } ],
              "groupTotals": [ { "columnId": "nope", "aggregate": "sum" } ] }
          ]
        }
        """);

        var errors = act.Should().Throw<ReportValidationException>().Which.Errors;
        errors.Should().Contain(e => e.Contains("'groupTotals' requires 'groupBy'"));
        errors.Should().Contain(e => e.Contains("groupTotals[0]: 'columnId' must reference a column"));

        var valid = ReportDefinitionParser.Parse("""
        {
          "schemaVersion": 1, "key": "k", "version": "1.0.0", "dataSource": "d",
          "body": [
            { "id": "t", "type": "table", "bind": "items", "groupBy": "dept",
              "columns": [ { "id": "c1", "header": "H", "path": "p" } ],
              "groupTotals": [ { "columnId": "c1", "aggregate": "count" } ] }
          ]
        }
        """);
        valid.Body.OfType<TableElement>().Single().GroupTotals.Should().ContainSingle()
            .Which.Aggregate.Should().Be("count");
    }

    [Fact]
    public void Table_column_ids_share_the_document_id_namespace()
    {
        var act = () => ReportDefinitionParser.Parse("""
        {
          "schemaVersion": 1, "key": "k", "version": "1.0.0", "dataSource": "d",
          "body": [
            { "id": "clash", "type": "text", "text": "x" },
            { "id": "t", "type": "table", "bind": "items",
              "columns": [ { "id": "clash", "header": "H", "path": "p" } ] }
          ]
        }
        """);

        act.Should().Throw<ReportValidationException>()
            .Which.Errors.Should().Contain(e => e.Contains("duplicate id 'clash'"));
    }

    [Fact]
    public void Align_values_are_normalized_to_lowercase()
    {
        // The renderer matches "center"/"right" case-sensitively; validation is
        // case-insensitive, so parse must normalize or "Right" would silently left-align.
        var model = ReportDefinitionParser.Parse("""
        {
          "schemaVersion": 1, "key": "k", "version": "1.0.0", "dataSource": "d",
          "body": [
            { "id": "txt", "type": "text", "text": "x", "style": { "align": "CENTER" } },
            { "id": "t", "type": "table", "bind": "items",
              "columns": [ { "id": "c1", "header": "H", "path": "p", "align": "Right" } ] }
          ]
        }
        """);

        model.Body[0].Style!.Align.Should().Be("center");
        model.Body.OfType<TableElement>().Single().Columns.Single().Align.Should().Be("right");
    }

    [Fact]
    public void LocalizedText_falls_back_to_the_primary_language_subtag_then_english()
    {
        var model = ReportDefinitionParser.Parse(MinimalValid);

        model.Title.Resolve("nl-NL").Should().Be("Testrapport", "nl-NL falls back to the nl entry");
        model.Title.Resolve("de-DE").Should().Be("Test report", "no de entry — falls back to en");
        model.Title.Resolve("nl").Should().Be("Testrapport", "exact match still wins");
    }

    [Fact]
    public void Parses_container_with_title_width_and_children()
    {
        var model = ReportDefinitionParser.Parse("""
        {
          "schemaVersion": 1, "key": "k", "version": "1.0.0", "dataSource": "d",
          "body": [
            { "id": "card", "type": "container", "width": "half",
              "title": { "en": "General", "nl": "Algemeen" },
              "children": [
                { "id": "inner-text", "type": "text", "text": "hello" },
                { "id": "nested-card", "type": "container", "children": [] }
              ] }
          ]
        }
        """);

        var card = model.Body.Should().ContainSingle().Which.Should().BeOfType<ContainerElement>().Subject;
        card.WidthMode.Should().Be("half");
        card.Title!.Resolve("nl").Should().Be("Algemeen");
        card.Children.Should().HaveCount(2);
        card.Children[1].Should().BeOfType<ContainerElement>()
            .Which.WidthMode.Should().Be("full", "width defaults to full");
    }

    [Fact]
    public void Rejects_invalid_container_width_and_duplicate_nested_ids()
    {
        var act = () => ReportDefinitionParser.Parse("""
        {
          "schemaVersion": 1, "key": "k", "version": "1.0.0", "dataSource": "d",
          "body": [
            { "id": "card", "type": "container", "width": "third", "children": [
              { "id": "card", "type": "text", "text": "clashes with parent" }
            ] }
          ]
        }
        """);

        var errors = act.Should().Throw<ReportValidationException>().Which.Errors;
        errors.Should().Contain(e => e.Contains("container width must be 'full' or 'half'"));
        errors.Should().Contain(e => e.Contains("duplicate element id 'card'"));
    }

    [Fact]
    public void ValidateElementSubtree_returns_errors_and_collected_ids_without_throwing()
    {
        var (errors, _) = ReportDefinitionParser.ValidateElementSubtree(
            (System.Text.Json.Nodes.JsonObject)System.Text.Json.Nodes.JsonNode.Parse(
                """{ "id": "x", "type": "field" }""")!);
        errors.Should().ContainSingle(e => e.Contains("'path' is required"));

        var (ok, ids) = ReportDefinitionParser.ValidateElementSubtree(
            (System.Text.Json.Nodes.JsonObject)System.Text.Json.Nodes.JsonNode.Parse(
                """{ "id": "outer", "type": "row", "children": [ { "id": "inner", "type": "text", "text": "t" } ] }""")!);
        ok.Should().BeEmpty();
        ids.Should().BeEquivalentTo("outer", "inner");
    }
}
