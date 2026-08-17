namespace PlatenReports;

/// <summary>One stored customisation overlay, as the engine sees it.</summary>
/// <remarks>
/// Deliberately not a persistence entity. Audit columns, foreign keys and storage-level
/// validation are host concerns a reporting package must never see. The record carries no
/// scope key either: which customer, tenant or workspace an overlay belongs to is the store's
/// business, and the engine has no concept to scope by.
/// </remarks>
/// <param name="ReportKey">The report this overlay customises.</param>
/// <param name="OverlayJson">The overlay document, verbatim.</param>
/// <param name="BaseVersion">Version of the base definition the overlay was authored against, when known.</param>
/// <param name="IsEnabled">Whether the overlay applies. A disabled overlay is stored but not merged.</param>
/// <param name="UpdatedAt">
/// <see cref="DateTime"/> rather than <see cref="DateTimeOffset"/> on purpose: this crosses the
/// wire as a plain timestamp string, and widening it would be a breaking change for no gain.
/// </param>
public sealed record ReportOverlayRecord(
    string ReportKey,
    string OverlayJson,
    string? BaseVersion,
    bool IsEnabled,
    DateTime UpdatedAt);

/// <summary>Persistence port for customisation overlays — one stored patch per report.</summary>
/// <remarks>
/// The store is keyed by an opaque scope its implementation owns; nothing in this contract
/// names a tenant. There is no unit of work either: each method completes its own write, so
/// deleting is one call rather than a sequence the caller has to get right.
/// </remarks>
public interface IReportOverlayStore
{
    /// <summary>Reads the overlay for one report.</summary>
    /// <param name="reportKey">The report key.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The stored overlay, or <see langword="null"/> when there is none.</returns>
    Task<ReportOverlayRecord?> GetAsync(string reportKey, CancellationToken ct = default);

    /// <summary>Every report key in scope that has an overlay row, enabled or not.</summary>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The stored overlays.</returns>
    Task<IReadOnlyList<ReportOverlayRecord>> GetAllAsync(CancellationToken ct = default);

    /// <summary>Race-safe insert-or-update of the overlay row for one report.</summary>
    /// <remarks>
    /// Must converge when two concurrent first-saves both see "no row" and both insert — an
    /// editor double-submit, or two admin tabs. The loser recovers into an update rather than
    /// surfacing a unique-index violation.
    /// </remarks>
    /// <param name="reportKey">The report key.</param>
    /// <param name="overlayJson">The overlay document.</param>
    /// <param name="baseVersion">Version of the base definition this was authored against.</param>
    /// <param name="isEnabled">Whether the overlay applies.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The persisted row.</returns>
    Task<ReportOverlayRecord> UpsertAsync(
        string reportKey, string overlayJson, string? baseVersion, bool isEnabled, CancellationToken ct = default);

    /// <summary>Removes the overlay for one report.</summary>
    /// <param name="reportKey">The report key.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns><see langword="false"/> when there was no row to delete.</returns>
    Task<bool> DeleteAsync(string reportKey, CancellationToken ct = default);
}
