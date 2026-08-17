namespace PlatenReports;

/// <summary>Outcome of evaluating one element's <c>visibleIf</c> condition.</summary>
/// <param name="Visible">Whether the element should render.</param>
/// <param name="Error">
/// Set only when the condition could not be evaluated — bad syntax, unknown identifier,
/// disallowed function. A condition that simply evaluated to <see langword="false"/>, including
/// the null-as-false short circuit, is hidden with no error. Callers log the error and hide the
/// element; they never surface it on the page.
/// </param>
public readonly record struct ConditionResult(bool Visible, string? Error)
{
    /// <summary>The element renders.</summary>
    public static readonly ConditionResult Shown = new(true, null);

    /// <summary>The element does not render.</summary>
    /// <param name="error">Why evaluation failed, or <see langword="null"/> when the condition was simply false.</param>
    /// <returns>A hidden result.</returns>
    public static ConditionResult Hidden(string? error = null) => new(false, error);
}

/// <summary>Evaluates and validates report element visibility conditions.</summary>
/// <remarks>
/// Deliberately narrow: "evaluate this expression against this flat scope", and nothing else.
/// A reporting package cannot ship a port that drags a general rules engine behind it, and the
/// engine never needed one. An implementation ships separately —
/// <c>PlatenReports.NCalc</c> is the reference one — so a host that never writes a condition
/// takes no expression dependency at all.
/// </remarks>
public interface IReportConditionEvaluator
{
    /// <summary>Render-time evaluation against the flattened scope.</summary>
    /// <remarks>
    /// <para><b>Null-as-false.</b> A null operand hides the element rather than erroring — reports
    /// print on incomplete data all the time, and a half-populated record must not produce a
    /// broken page.</para>
    /// <para><b>Never throws for content reasons.</b> Every failure — parse error, unknown
    /// identifier, disallowed function, arithmetic fault — comes back as a hidden
    /// <see cref="ConditionResult"/> carrying an <see cref="ConditionResult.Error"/>. A printed
    /// document must never fail because one element's condition was wrong.</para>
    /// </remarks>
    /// <param name="expression">The condition text.</param>
    /// <param name="scope">Flattened dotted-path scope the expression may read.</param>
    /// <returns>Whether to render, plus an error when evaluation failed.</returns>
    ConditionResult Evaluate(string expression, IReadOnlyDictionary<string, object?> scope);

    /// <summary>Authoring-time syntax and allowlist check.</summary>
    /// <param name="expression">The raw condition text.</param>
    /// <param name="knownPaths">
    /// The paths a condition may reference, from the data provider's field tree — see
    /// <see cref="ReportFieldNode.ConditionPaths"/>. Pass <see langword="null"/> to skip
    /// field-existence checking and validate syntax and functions only.
    /// </param>
    /// <returns>Every problem found; empty means valid.</returns>
    IReadOnlyList<string> Validate(string expression, IReadOnlySet<string>? knownPaths = null);
}
