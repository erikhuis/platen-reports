using FluentAssertions;
using PlatenReports.Model;
using Xunit;

namespace PlatenReports.Core.Tests;

/// <summary>
/// Issue #2440 — the walk that finds every <c>ImageElement</c> so the orchestrator can resolve
/// its assets before rendering. Missing a branch here means a logo that silently never prints,
/// so the roots and the nesting types are pinned explicitly.
/// </summary>
public class ReportElementTreeTests
{
    [Fact]
    public void Visits_page_header_body_and_page_footer()
    {
        var model = ReportDefinitionParser.Parse("""
        {
          "schemaVersion": 1, "key": "k", "version": "1.0.0", "title": "T", "dataSource": "s",
          "pageHeader": { "id": "hdr", "type": "image", "source": "tenantLogo" },
          "body": [ { "id": "b", "type": "text", "text": "x" } ],
          "pageFooter": { "id": "ftr", "type": "image", "source": "tenantLogo" }
        }
        """);

        ReportElementTree.Descendants(model).Select(e => e.Id)
            .Should().BeEquivalentTo(["hdr", "b", "ftr"]);
    }

    [Fact]
    public void Descends_into_rows_columns_and_containers()
    {
        var model = ReportDefinitionParser.Parse("""
        {
          "schemaVersion": 1, "key": "k", "version": "1.0.0", "title": "T", "dataSource": "s",
          "body": [
            { "id": "container", "type": "container", "title": "C", "children": [
              { "id": "row", "type": "row", "children": [
                { "id": "column", "type": "column", "children": [
                  { "id": "deep-logo", "type": "image", "source": "tenantLogo" }
                ]}
              ]}
            ]}
          ]
        }
        """);

        ReportElementTree.Descendants(model).Select(e => e.Id)
            .Should().BeEquivalentTo(["container", "row", "column", "deep-logo"]);
    }

    [Fact]
    public void Finds_an_image_nested_several_levels_down()
    {
        var model = ReportDefinitionParser.Parse("""
        {
          "schemaVersion": 1, "key": "k", "version": "1.0.0", "title": "T", "dataSource": "s",
          "body": [
            { "id": "outer", "type": "container", "title": "O", "children": [
              { "id": "inner", "type": "container", "title": "I", "children": [
                { "id": "logo", "type": "image", "source": "tenantLogo", "height": 20 }
              ]}
            ]}
          ]
        }
        """);

        ReportElementTree.Descendants(model).OfType<ImageElement>()
            .Should().ContainSingle().Which.Source.Should().Be("tenantLogo");
    }

    [Fact]
    public void Handles_a_document_with_no_header_or_footer()
    {
        var model = ReportDefinitionParser.Parse("""
        {
          "schemaVersion": 1, "key": "k", "version": "1.0.0", "title": "T", "dataSource": "s",
          "body": [ { "id": "only", "type": "text", "text": "x" } ]
        }
        """);

        ReportElementTree.Descendants(model).Select(e => e.Id).Should().BeEquivalentTo(["only"]);
    }

    [Fact]
    public void Includes_the_element_itself_when_walking_from_one()
    {
        var image = new ImageElement { Id = "solo", Source = "tenantLogo" };

        ReportElementTree.Descendants(image).Should().ContainSingle().Which.Should().BeSameAs(image);
    }
}
