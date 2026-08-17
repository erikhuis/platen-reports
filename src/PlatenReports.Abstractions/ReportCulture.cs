using System.Globalization;

namespace PlatenReports;

/// <summary>
/// Resolves a report locale (<c>"en"</c>, <c>"nl-NL"</c>, …) to a <see cref="CultureInfo"/> for
/// number and date formatting.
/// </summary>
/// <remarks>
/// <para>A locale that .NET cannot resolve at all falls back to the invariant culture: a bad
/// value from a caller must never make a report unprintable. Shared by the orchestrator and the
/// renderer so both format with the same culture.</para>
/// <para><b>Sharp edge:</b> .NET resolves far more names than exist as real cultures. With ICU,
/// <c>"not-a-locale"</c> yields a neutral culture named <c>"not"</c> rather than throwing, so
/// the invariant fallback fires less often than it looks. The formatting result is still
/// deterministic; it is simply not always invariant.</para>
/// </remarks>
public static class ReportCulture
{
    /// <summary>Resolves a locale tag to a culture.</summary>
    /// <param name="locale">
    /// A locale tag. The empty string resolves to the invariant culture, as
    /// <see cref="CultureInfo.GetCultureInfo(string)"/> defines it.
    /// </param>
    /// <returns>The matching culture, or <see cref="CultureInfo.InvariantCulture"/> when the tag is not a known culture.</returns>
    /// <exception cref="ArgumentNullException"><paramref name="locale"/> is <see langword="null"/>.</exception>
    public static CultureInfo Resolve(string locale)
    {
        try
        {
            return CultureInfo.GetCultureInfo(locale);
        }
        catch (CultureNotFoundException)
        {
            return CultureInfo.InvariantCulture;
        }
    }
}
