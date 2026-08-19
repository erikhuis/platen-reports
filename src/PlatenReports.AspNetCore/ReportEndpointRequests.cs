namespace PlatenReports.AspNetCore;

/// <summary>Body of a PUT or validate request against a report's customisation overlay.</summary>
/// <param name="OverlayJson">The overlay document. Required; an empty one is a rejection, not a delete.</param>
/// <param name="IsEnabled">Whether the overlay applies at render time. Stored either way.</param>
public sealed record PutOverlayRequest(string OverlayJson, bool IsEnabled = true);

/// <summary>Body of a live-preview request: render without persisting anything.</summary>
/// <param name="OverlayJson">A draft overlay to preview, or <see langword="null"/> for the stored one.</param>
/// <param name="Parameters">Report parameters. <see langword="null"/> is treated as none.</param>
/// <param name="Locale">Display language for the rendered document. Defaults to <c>en</c>.</param>
/// <param name="TimeZone">IANA zone stamped into the document.</param>
/// <param name="DefinitionJson">
/// A draft *definition* to preview, for authoring a published definition rather than patching one.
/// Takes precedence over <paramref name="OverlayJson"/>, which is then ignored.
/// </param>
public sealed record PreviewRequest(
    string? OverlayJson,
    Dictionary<string, string>? Parameters,
    string? Locale,
    string? TimeZone = null,
    string? DefinitionJson = null);
