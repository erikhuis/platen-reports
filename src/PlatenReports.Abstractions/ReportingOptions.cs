namespace PlatenReports;

/// <summary>Host-tunable knobs for the reporting engine.</summary>
/// <remarks>
/// <para>Every value defaults to sensible behaviour, so an engine constructed without options
/// works. The point is not that these need tuning — it is that a package cannot bake constants
/// into its internals and expect every host to agree with them.</para>
/// <para>The template limits are a <b>security posture</b>, not a performance dial. Overlay
/// templates are authored by customer administrators and rendered unattended, so the loop and
/// recursion caps are what stand between a hostile template and the render thread
/// (see GHSA-24c8-4792-22hx). Raise them deliberately or not at all.</para>
/// </remarks>
public sealed class ReportingOptions
{
    /// <summary>Shared instance for callers that do not configure anything.</summary>
    public static readonly ReportingOptions Default = new();

    /// <summary>Locale used when a render request does not name one.</summary>
    public string DefaultLocale { get; init; } = "en";

    /// <summary>
    /// Upper bound on distinct parsed templates held in the process-wide cache. Definitions
    /// hold a small, stable set; the cap exists so a pathological overlay that churns unique
    /// templates stops caching rather than growing without limit.
    /// </summary>
    public int TemplateCacheLimit { get; init; } = 2000;

    /// <summary>Iterations a single template may run.</summary>
    public int ScribanLoopLimit { get; init; } = 1000;

    /// <summary>Nesting depth a single template may reach.</summary>
    public int ScribanRecursiveLimit { get; init; } = 100;
}
