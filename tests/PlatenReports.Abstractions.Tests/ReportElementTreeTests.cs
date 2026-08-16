using FluentAssertions;
using PlatenReports.Model;
using Xunit;

namespace PlatenReports.Abstractions.Tests;

public class ReportElementTreeTests
{
    private static TextElement Text(string id) => new() { Id = id, Text = new LocalizedText(id) };

    [Fact]
    public void Descendants_walks_header_body_and_footer_in_document_order()
    {
        var model = new ReportDocumentModel
        {
            Key = "r",
            Version = "1.0.0",
            Title = new LocalizedText("R"),
            DataSource = "d",
            PageHeader = Text("hdr"),
            Body = [Text("a"), Text("b")],
            PageFooter = Text("ftr"),
        };

        ReportElementTree.Descendants(model).Select(e => e.Id)
            .Should().Equal("hdr", "a", "b", "ftr");
    }

    [Fact]
    public void Descendants_recurses_into_rows_columns_and_containers()
    {
        var tree = new ContainerElement
        {
            Id = "card",
            Children =
            [
                new RowElement { Id = "row", Children = [Text("left"), Text("right")] },
                new ColumnElement { Id = "col", Children = [Text("stacked")] },
            ],
        };

        ReportElementTree.Descendants(tree).Select(e => e.Id)
            .Should().Equal("card", "row", "left", "right", "col", "stacked");
    }

    [Fact]
    public void Descendants_does_not_descend_into_table_columns_or_grid_pairs()
    {
        // Columns and pairs are their own definition types, not ReportElements — there is
        // nothing below them to yield, and treating them as elements would be a type error.
        var table = new TableElement
        {
            Id = "tbl",
            Bind = "lines",
            Columns = [new TableColumnDefinition { Id = "col-a", Header = new LocalizedText("A"), Path = "a" }],
        };
        var grid = new KeyValueGridElement
        {
            Id = "grid",
            Pairs = [new KeyValuePairDefinition { Id = "pair-a", Label = new LocalizedText("A"), Path = "a" }],
        };

        ReportElementTree.Descendants(table).Select(e => e.Id).Should().Equal("tbl");
        ReportElementTree.Descendants(grid).Select(e => e.Id).Should().Equal("grid");
    }

    [Fact]
    public void A_document_with_no_header_or_footer_yields_only_its_body()
    {
        var model = new ReportDocumentModel
        {
            Key = "r",
            Version = "1.0.0",
            Title = new LocalizedText("R"),
            DataSource = "d",
            Body = [Text("only")],
        };

        ReportElementTree.Descendants(model).Select(e => e.Id).Should().Equal("only");
    }
}
