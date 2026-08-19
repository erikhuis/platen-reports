namespace PlatenReports.AspNetCore;

/// <summary>Decides who may read, author and print reports.</summary>
/// <remarks>
/// <para>The one thing this package cannot decide for you. It ships no default: a host must
/// register an implementation, or <c>MapReportEndpoints</c> has nothing to ask and the endpoints
/// fail closed at resolution rather than serving everyone.</para>
/// <para>Deliberately not tied to <c>ClaimsPrincipal</c>, a policy name or an authentication
/// scheme. The render endpoint is reached by a plain <c>&lt;a href&gt;</c> navigation in at least
/// one real host, which carries no bearer token — so an implementation reads whatever its own
/// host makes available (cookie, header, ambient context) and answers the question. Injecting
/// <c>IHttpContextAccessor</c> is the usual way.</para>
/// </remarks>
public interface IReportAuthorizer
{
    /// <summary>May the caller see the report catalogue, definitions and field trees?</summary>
    /// <param name="ct">Cancellation token.</param>
    /// <returns><see langword="true"/> to allow.</returns>
    ValueTask<bool> CanViewCatalogueAsync(CancellationToken ct = default);

    /// <summary>May the caller create, change or delete customisation overlays and definitions?</summary>
    /// <param name="ct">Cancellation token.</param>
    /// <returns><see langword="true"/> to allow.</returns>
    ValueTask<bool> CanManageDefinitionsAsync(CancellationToken ct = default);

    /// <summary>May the caller render this particular report?</summary>
    /// <remarks>
    /// Asked per report, because a definition may declare a permission covering the *data* it
    /// prints rather than the act of printing — a host that gates "may print at all" and "may
    /// see work orders" separately needs both, and only it knows how they combine.
    /// </remarks>
    /// <param name="reportKey">The report being rendered.</param>
    /// <param name="requiredPermission">
    /// The permission the definition declares, or <see langword="null"/> when it declares none.
    /// </param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns><see langword="true"/> to allow.</returns>
    ValueTask<bool> CanRenderAsync(string reportKey, string? requiredPermission, CancellationToken ct = default);
}
