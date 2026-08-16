using PlatenReports.Model;

namespace PlatenReports;

/// <summary>Everything a renderer needs for one render, resolved up front.</summary>
/// <param name="Data">The bound data, with <c>meta</c> already injected.</param>
/// <param name="Locale">Used for label resolution and number/date formatting.</param>
/// <param name="TimeZone">UTC date-times in the data are converted to this before formatting.</param>
/// <param name="Assets">
/// Resolved assets keyed by <see cref="ImageElement.Source"/>, case-insensitively. A source
/// with no entry simply draws nothing — see <see cref="IReportAssetProvider"/>.
/// </param>
public sealed record ReportRenderContext(
    ReportDataContext Data,
    string Locale,
    TimeZoneInfo TimeZone,
    IReadOnlyDictionary<string, ReportAsset> Assets);

/// <summary>Renders a parsed report definition against its data.</summary>
/// <remarks>
/// <para><b>Assets arrive pre-resolved.</b> The orchestrator walks the model, resolves each
/// distinct image source exactly once through <see cref="IReportAssetProvider"/>, and hands the
/// result over. That keeps <see cref="Render"/> synchronous — a renderer's tree walk usually is —
/// without a blocking wait buried inside it, and de-duplicates a logo used in both the header
/// and the footer.</para>
/// <para><b>The output format is the renderer's to declare.</b> <see cref="ContentType"/> and
/// <see cref="FileExtension"/> mean nothing above this seam hardcodes <c>.pdf</c>, so an HTML
/// or spreadsheet renderer needs no change anywhere else.</para>
/// </remarks>
public interface IReportRenderer
{
    /// <summary>MIME type of what <see cref="Render"/> produces, e.g. <c>application/pdf</c>.</summary>
    string ContentType { get; }

    /// <summary>File extension without the leading dot, e.g. <c>pdf</c>.</summary>
    string FileExtension { get; }

    /// <summary>Renders the document.</summary>
    /// <param name="document">The parsed, merged definition.</param>
    /// <param name="context">Data, locale, time zone and resolved assets.</param>
    /// <returns>The rendered bytes.</returns>
    byte[] Render(ReportDocumentModel document, ReportRenderContext context);
}
