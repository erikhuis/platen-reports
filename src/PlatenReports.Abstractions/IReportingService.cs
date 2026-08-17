using PlatenReports.Model;

namespace PlatenReports;

/// <summary>
/// Orchestrates the engine: base definition + customisation overlay → merge → parse →
/// data provider → rendered bytes.
/// </summary>
/// <remarks>
/// This is the surface a host's HTTP layer sits directly on top of. The implementation lives
/// in <c>PlatenReports.Core</c>; the interface is here so a host can depend on it, fake it in
/// tests, or decorate it without taking the engine.
/// </remarks>
public interface IReportingService
{
    /// <summary>Lists the reports available in the current scope.</summary>
    /// <param name="locale">Locale for catalogue titles. Null or empty falls back to the configured default.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The catalogue.</returns>
    Task<IReadOnlyList<ReportCatalogueItemDto>> ListAsync(string? locale = null, CancellationToken ct = default);

    /// <summary>The merged definition — base plus any enabled overlay — as JSON.</summary>
    /// <param name="reportKey">The report key.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The effective definition, or <see langword="null"/> when the key is unknown.</returns>
    Task<EffectiveDefinitionDto?> GetEffectiveDefinitionAsync(string reportKey, CancellationToken ct = default);

    /// <summary>The base definition as published, ignoring any overlay.</summary>
    /// <param name="reportKey">The report key.</param>
    /// <returns>The definition JSON, or <see langword="null"/> when the key is unknown.</returns>
    string? GetStandardDefinitionJson(string reportKey);

    /// <summary>
    /// The permission the report declares for its data, read straight from the base definition.
    /// Cheap enough for a per-request check on render and preview.
    /// </summary>
    /// <param name="reportKey">The report key.</param>
    /// <returns>The permission name, or <see langword="null"/> when the key is unknown or none is declared.</returns>
    string? GetRequiredPermission(string reportKey);

    /// <summary>The field tree of the report's data provider, for editor autocomplete.</summary>
    /// <param name="reportKey">The report key.</param>
    /// <returns>The field tree, or <see langword="null"/> when the key is unknown.</returns>
    ReportFieldNode? GetFields(string reportKey);

    /// <summary>Reads the stored overlay for one report.</summary>
    /// <param name="reportKey">The report key.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The overlay, or <see langword="null"/> when there is none in scope.</returns>
    Task<ReportOverlayDto?> GetOverlayAsync(string reportKey, CancellationToken ct = default);

    /// <summary>Validates and stores an overlay.</summary>
    /// <param name="reportKey">The report key.</param>
    /// <param name="overlayJson">The overlay document.</param>
    /// <param name="isEnabled">Whether the overlay applies once stored.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The merge result, including any non-fatal warnings.</returns>
    /// <exception cref="ReportValidationException">The overlay is structurally invalid; nothing was stored.</exception>
    /// <exception cref="KeyNotFoundException">The report key is unknown.</exception>
    Task<OverlayValidationResultDto> PutOverlayAsync(
        string reportKey, string overlayJson, bool isEnabled, CancellationToken ct = default);

    /// <summary>Removes the stored overlay, reverting the report to its base definition.</summary>
    /// <param name="reportKey">The report key.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns><see langword="false"/> when there was no overlay to delete.</returns>
    Task<bool> DeleteOverlayAsync(string reportKey, CancellationToken ct = default);

    /// <summary>Dry-run validation and merge of a draft overlay. Nothing is persisted.</summary>
    /// <param name="reportKey">The report key.</param>
    /// <param name="overlayJson">The draft overlay document.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The merge result, including any non-fatal warnings.</returns>
    /// <exception cref="KeyNotFoundException">The report key is unknown.</exception>
    Task<OverlayValidationResultDto> ValidateOverlayAsync(
        string reportKey, string overlayJson, CancellationToken ct = default);

    /// <summary>Renders the report.</summary>
    /// <param name="reportKey">The report key.</param>
    /// <param name="parameters">Raw parameter values from the caller.</param>
    /// <param name="locale">Locale for label resolution and formatting.</param>
    /// <param name="draftOverlayJson">
    /// An unsaved overlay to apply for this render only, for an editor's live preview. Replaces
    /// the stored overlay when set.
    /// </param>
    /// <param name="timeZone">
    /// Time-zone id of the caller, e.g. <c>Europe/Amsterdam</c>, used to stamp the document's
    /// generated-at metadata. Null or unknown falls back to UTC.
    /// </param>
    /// <param name="draftDefinitionJson">
    /// An unsaved base definition to render instead of the stored one, for structural authoring
    /// previews. Takes precedence over the overlay, which is ignored when this is set.
    /// </param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The rendered bytes, filename, content type and any merge warnings.</returns>
    /// <exception cref="KeyNotFoundException">The report key or a referenced record is unknown.</exception>
    /// <exception cref="ReportParameterException">A required parameter is missing or malformed.</exception>
    /// <exception cref="ReportValidationException"><paramref name="draftDefinitionJson"/> failed to parse.</exception>
    Task<ReportRenderResult> RenderAsync(
        string reportKey,
        IReadOnlyDictionary<string, string> parameters,
        string locale,
        string? draftOverlayJson = null,
        string? timeZone = null,
        string? draftDefinitionJson = null,
        CancellationToken ct = default);
}

/// <summary>One entry in the report catalogue.</summary>
/// <param name="Key">The report key.</param>
/// <param name="Title">Display title, already resolved for the requested locale.</param>
/// <param name="Version">The base definition's version.</param>
/// <param name="DataSource">The data provider this report binds to.</param>
/// <param name="RequiredPermission">The permission the definition declares, when it declares one.</param>
/// <param name="HasOverlay">Whether an overlay row exists in scope, enabled or not.</param>
/// <param name="OverlayEnabled">Whether that overlay currently applies.</param>
/// <param name="Parameters">The inputs a render call must supply.</param>
public sealed record ReportCatalogueItemDto(
    string Key,
    string Title,
    string Version,
    string DataSource,
    string? RequiredPermission,
    bool HasOverlay,
    bool OverlayEnabled,
    IReadOnlyList<ReportParameterDto> Parameters);

/// <summary>One declared report input, flattened for the wire.</summary>
/// <param name="Name">Parameter name.</param>
/// <param name="Type">One of <c>guid</c>, <c>string</c>, <c>int</c>, <c>decimal</c>, <c>date</c>, <c>bool</c>.</param>
/// <param name="Required">Whether a render may proceed without it.</param>
public sealed record ReportParameterDto(string Name, string Type, bool Required);

/// <summary>The merged definition plus what the merge had to skip.</summary>
/// <param name="DefinitionJson">Base definition with any enabled overlay applied.</param>
/// <param name="StandardVersion">Version of the base definition it was merged from.</param>
/// <param name="Warnings">Patches that could not be applied.</param>
public sealed record EffectiveDefinitionDto(
    string DefinitionJson,
    string StandardVersion,
    IReadOnlyList<OverlayMergeWarning> Warnings);

/// <summary>A stored overlay, flattened for the wire.</summary>
/// <param name="ReportKey">The report this overlay customises.</param>
/// <param name="OverlayJson">The overlay document.</param>
/// <param name="BaseVersion">Version of the base definition it was authored against.</param>
/// <param name="IsEnabled">Whether it currently applies.</param>
/// <param name="UpdatedAt">When it was last written.</param>
public sealed record ReportOverlayDto(
    string ReportKey,
    string OverlayJson,
    string? BaseVersion,
    bool IsEnabled,
    DateTime UpdatedAt);

/// <summary>Outcome of validating or storing an overlay.</summary>
/// <param name="Valid">Whether the overlay is structurally sound.</param>
/// <param name="Errors">Fatal problems. Non-empty means nothing was stored.</param>
/// <param name="Warnings">Patches that merged with a caveat, or were skipped.</param>
public sealed record OverlayValidationResultDto(
    bool Valid,
    IReadOnlyList<string> Errors,
    IReadOnlyList<OverlayMergeWarning> Warnings);

/// <summary>A rendered document.</summary>
/// <param name="Content">The rendered bytes.</param>
/// <param name="FileName">Suggested filename, extension included.</param>
/// <param name="ContentType">
/// From <see cref="IReportRenderer.ContentType"/>. Relayed rather than assumed, so it cannot
/// disagree with the extension in <paramref name="FileName"/>.
/// </param>
/// <param name="Warnings">Overlay patches the merge had to skip for this render.</param>
public sealed record ReportRenderResult(
    byte[] Content,
    string FileName,
    string ContentType,
    IReadOnlyList<OverlayMergeWarning> Warnings);
