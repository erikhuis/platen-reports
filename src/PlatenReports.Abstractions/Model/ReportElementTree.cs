namespace PlatenReports.Model;

/// <summary>Traversal over a parsed document's element tree.</summary>
/// <remarks>
/// Only <see cref="RowElement"/>, <see cref="ColumnElement"/> and <see cref="ContainerElement"/>
/// nest elements. A table's columns and a key-value grid's pairs are their own definition
/// types rather than <see cref="ReportElement"/>s, so there is nothing to descend into there.
/// </remarks>
public static class ReportElementTree
{
    /// <summary>Every element in the document — page header, body, page footer — depth-first, including the roots.</summary>
    /// <param name="model">The parsed document.</param>
    /// <returns>The elements, in document order.</returns>
    public static IEnumerable<ReportElement> Descendants(ReportDocumentModel model)
    {
        if (model.PageHeader is not null)
        {
            foreach (var element in Descendants(model.PageHeader))
            {
                yield return element;
            }
        }

        foreach (var root in model.Body)
        {
            foreach (var element in Descendants(root))
            {
                yield return element;
            }
        }

        if (model.PageFooter is not null)
        {
            foreach (var element in Descendants(model.PageFooter))
            {
                yield return element;
            }
        }
    }

    /// <summary>The element and everything beneath it, depth-first.</summary>
    /// <param name="element">The subtree root.</param>
    /// <returns>The element followed by its descendants.</returns>
    public static IEnumerable<ReportElement> Descendants(ReportElement element)
    {
        yield return element;

        var children = element switch
        {
            RowElement row => row.Children,
            ColumnElement column => column.Children,
            ContainerElement container => container.Children,
            _ => null,
        };

        foreach (var child in children ?? [])
        {
            foreach (var descendant in Descendants(child))
            {
                yield return descendant;
            }
        }
    }
}
