namespace PlatenReports;

/// <summary>A binary asset a report can draw.</summary>
/// <param name="Content">The bytes. Never empty: a provider with nothing to give returns null instead.</param>
/// <param name="ContentType">Optional MIME type, informational for renderers that care.</param>
public sealed record ReportAsset(byte[] Content, string? ContentType = null);

/// <summary>
/// Resolves the assets a report definition references, by the element's <c>source</c> value.
/// </summary>
/// <remarks>
/// The engine has no idea what your assets are or where they live. Branding is an injectable
/// hook: the host decides what a source name such as <c>"tenantLogo"</c> means and supplies the
/// bytes, and the engine only ever asks by name. That is what keeps multi-tenancy, storage and
/// caching entirely on the host's side of the seam.
/// </remarks>
public interface IReportAssetProvider
{
    /// <summary>Resolves one asset.</summary>
    /// <param name="source">The <see cref="Model.ImageElement.Source"/> value, verbatim.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The asset, or <see langword="null"/> when this source is unknown or has nothing to draw.</returns>
    ValueTask<ReportAsset?> GetAsync(string source, CancellationToken ct = default);
}
