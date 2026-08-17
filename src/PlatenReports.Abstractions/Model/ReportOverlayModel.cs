namespace PlatenReports.Model;

/// <summary>
/// Structured warning emitted while merging a customisation overlay over a base definition.
/// </summary>
/// <remarks>
/// Warnings are never fatal: the offending patch is skipped and the report still renders. That
/// is deliberate — a definition update that moves an element must degrade a customisation, not
/// take the document offline. Hosts surface them from the validate and preview paths.
/// </remarks>
/// <param name="Code">Machine code for the condition; the stable part of the contract.</param>
/// <param name="PatchId">Id of the overlay patch that was skipped, when the warning has one.</param>
/// <param name="TargetId">Id of the element the patch addressed, when the warning has one.</param>
/// <param name="Message">Human-readable detail. Wording is not part of the contract.</param>
public sealed record OverlayMergeWarning(
    OverlayMergeWarningCode Code,
    string? PatchId,
    string? TargetId,
    string Message);

/// <summary>Why an overlay patch was skipped during a merge.</summary>
public enum OverlayMergeWarningCode
{
    /// <summary>A suppress patch named an element the base definition no longer contains.</summary>
    SuppressedIdNotFound,

    /// <summary>An insert patch anchored to an element that does not exist.</summary>
    InsertAnchorNotFound,

    /// <summary>An insert patch used a position its anchor does not support.</summary>
    InsertInvalidPosition,

    /// <summary>An insert patch targeted a node that cannot take children.</summary>
    InsertInvalidTarget,

    /// <summary>An inserted element reused an id already present in the document.</summary>
    InsertIdCollision,

    /// <summary>An inserted element was structurally invalid and could not be built.</summary>
    InsertInvalidElement,

    /// <summary>A property patch named an element that does not exist.</summary>
    SetPropsIdNotFound,

    /// <summary>A property patch tried to set a property overlays are not allowed to change.</summary>
    SetPropsDisallowedProp,

    /// <summary>The overlay was authored against an older version of the base definition.</summary>
    BaseVersionOutdated,

    /// <summary>Suppressing this element would break the document structurally — the last column or pair, or a column a total references.</summary>
    SuppressBlocked,
}

/// <summary>
/// Fatal validation failure for a report definition or overlay document: malformed JSON,
/// missing ids, unknown element types, and the like.
/// </summary>
/// <remarks>
/// Raised when a document is accepted for storage, so invalid documents are never persisted.
/// The render path does not throw this — it falls back to the base definition instead, because
/// a printed document must not fail on a bad customisation.
/// </remarks>
public sealed class ReportValidationException : Exception
{
    /// <summary>Every problem found, not just the first.</summary>
    public IReadOnlyList<string> Errors { get; }

    /// <summary>Creates the exception from a set of problems.</summary>
    /// <param name="errors">The problems found.</param>
    public ReportValidationException(IReadOnlyList<string> errors)
        : base($"Report document is invalid: {string.Join("; ", errors)}")
    {
        Errors = errors;
    }

    /// <summary>Creates the exception from a single problem.</summary>
    /// <param name="error">The problem found.</param>
    public ReportValidationException(string error) : this([error]) { }
}

/// <summary>Thrown by data providers when required parameters are missing or malformed.</summary>
/// <remarks>Hosts map this to a client error; it always means the caller sent something wrong.</remarks>
public sealed class ReportParameterException : Exception
{
    /// <summary>Creates the exception.</summary>
    /// <param name="message">What was wrong with the parameters.</param>
    public ReportParameterException(string message) : base(message) { }
}
