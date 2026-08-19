using NCalc;
using NCalc.Exceptions;
using NCalc.Factories;
using NCalc.Handlers;

namespace PlatenReports.NCalc;

/// <summary>
/// NCalc-backed <see cref="IReportConditionEvaluator"/> for report element visibility.
/// </summary>
/// <remarks>
/// <para>Stateless and thread-safe: every call builds its own expression. Register it as a
/// singleton.</para>
/// <para><b>The function allowlist is fixed, not configurable.</b> Conditions are authored
/// through the designer by people who are not necessarily the people running the process, so the
/// set of callable functions is a security boundary rather than a deployment knob. Widening it
/// belongs in a pull request with a rationale, not in a config file.</para>
/// <para>A host that wants different semantics implements
/// <see cref="IReportConditionEvaluator"/> itself; nothing in the engine assumes NCalc.</para>
/// </remarks>
public sealed class NCalcReportConditionEvaluator : IReportConditionEvaluator
{
    /// <remarks>
    /// Callable functions only. <c>not</c>, <c>and</c> and <c>or</c> are deliberately absent:
    /// they are NCalc *operators* (<c>!</c>, <c>&amp;&amp;</c>, <c>||</c>), not functions, so
    /// allowlisting them let <c>and(x, y)</c> pass validation and then die at render with
    /// FunctionNotFound. Validation blessing an expression that can never evaluate is worse than
    /// not checking it. The operator forms are unaffected — operators never reach the allowlist.
    /// </remarks>
    private static readonly HashSet<string> AllowedFunctions = new(StringComparer.OrdinalIgnoreCase)
    {
        "if", "in",
        "Round", "Floor", "Ceiling",
        "Contains", "StartsWith", "EndsWith",
    };

    // ─── Evaluate ─────────────────────────────────────────────────────────────

    /// <inheritdoc />
    public ConditionResult Evaluate(string expression, IReadOnlyDictionary<string, object?> scope)
    {
        // An absent condition is not a condition; the renderer already short-circuits this, but
        // the port's contract should not depend on the caller remembering to.
        if (string.IsNullOrWhiteSpace(expression))
        {
            return ConditionResult.Shown;
        }

        Expression expr;
        try
        {
            expr = new Expression(NCalcIdentifierRewriter.WrapDottedIdentifiers(expression));
            // Force the parse so syntax errors surface here rather than mid-evaluation.
            _ = expr.LogicalExpression;
        }
        catch (Exception ex)
        {
            return ConditionResult.Hidden(ex.Message);
        }

        expr.EvaluateParameter += (name, args) =>
        {
            if (!scope.TryGetValue(name, out object? value))
            {
                throw new UnknownPathException(name);
            }

            // Null-as-false: short-circuit the whole expression rather than letting NCalc
            // compare against null. Raised as a sentinel so nothing further evaluates.
            if (value is null)
            {
                throw new NullOperandException();
            }

            args.Result = value;
        };

        expr.EvaluateFunction += (name, args) =>
        {
            if (!AllowedFunctions.Contains(name))
            {
                throw new DisallowedFunctionException(name);
            }

            // NCalc has no string helpers of its own; supply the three in the allowlist and let
            // everything else fall through to NCalc's built-ins (if, in, Round, Floor, Ceiling).
            if (name.Equals("StartsWith", StringComparison.OrdinalIgnoreCase))
            {
                args.Result = StringBinOp(args, (a, b) => a.StartsWith(b, StringComparison.Ordinal));
            }
            else if (name.Equals("EndsWith", StringComparison.OrdinalIgnoreCase))
            {
                args.Result = StringBinOp(args, (a, b) => a.EndsWith(b, StringComparison.Ordinal));
            }
            else if (name.Equals("Contains", StringComparison.OrdinalIgnoreCase))
            {
                args.Result = StringBinOp(args, (a, b) => a.Contains(b, StringComparison.Ordinal));
            }
        };

        try
        {
            return expr.Evaluate() is bool and true ? ConditionResult.Shown : ConditionResult.Hidden();
        }
        catch (NullOperandException)
        {
            // Not an error — this is the documented null-as-false outcome.
            return ConditionResult.Hidden();
        }
        catch (DisallowedFunctionException ex)
        {
            return ConditionResult.Hidden($"Function '{ex.FunctionName}' is not allowed.");
        }
        catch (UnknownPathException ex)
        {
            return ConditionResult.Hidden($"Unknown field '{ex.Path}'.");
        }
        catch (Exception ex)
        {
            return ConditionResult.Hidden(ex.Message);
        }
    }

    // ─── Validate ─────────────────────────────────────────────────────────────

    /// <inheritdoc />
    public IReadOnlyList<string> Validate(string expression, IReadOnlySet<string>? knownPaths = null)
    {
        if (string.IsNullOrWhiteSpace(expression))
        {
            return [];
        }

        LogicalExpression ast;
        try
        {
            ast = LogicalExpressionFactory.Create(NCalcIdentifierRewriter.WrapDottedIdentifiers(expression));
        }
        catch (NCalcParserException ex)
        {
            return [$"does not parse: {ex.Message}"];
        }
        catch (Exception ex)
        {
            return [$"does not parse: {ex.Message}"];
        }

        // Collect every problem rather than stopping at the first: an authoring UI shows these
        // together, and fixing one error per round-trip is miserable.
        var errors = new List<string>();
        Walk(ast, knownPaths, errors);
        return errors;
    }

    private static void Walk(LogicalExpression? node, IReadOnlySet<string>? knownPaths, List<string> errors)
    {
        switch (node)
        {
            case null:
                return;
            case BinaryExpression b:
                Walk(b.LeftExpression, knownPaths, errors);
                Walk(b.RightExpression, knownPaths, errors);
                return;
            case UnaryExpression u:
                Walk(u.Expression, knownPaths, errors);
                return;
            case TernaryExpression t:
                Walk(t.LeftExpression, knownPaths, errors);
                Walk(t.MiddleExpression, knownPaths, errors);
                Walk(t.RightExpression, knownPaths, errors);
                return;
            case Function f:
                if (!AllowedFunctions.Contains(f.Identifier.Name))
                {
                    errors.Add($"function '{f.Identifier.Name}' is not allowed.");
                }

                foreach (var p in f.Parameters)
                {
                    Walk(p, knownPaths, errors);
                }

                return;
            case Identifier id:
                if (knownPaths is not null && !knownPaths.Contains(id.Name))
                {
                    errors.Add($"unknown field '{id.Name}'.");
                }

                return;
            case LogicalExpressionList list:
                // `x in (a, b, c)` parses to a BinaryExpression whose right side is this node.
                // Without this case the walk stops here, and everything inside an `in` list —
                // unknown fields, disallowed functions — escapes authoring-time validation and
                // goes on to hide the element silently at render, which is the exact failure
                // this validation exists to prevent.
                foreach (var item in list)
                {
                    Walk(item, knownPaths, errors);
                }

                return;
            default:
                return;
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    private static bool StringBinOp(FunctionEventArgs args, Func<string, string, bool> op)
    {
        if (args.Parameters.Count != 2)
        {
            throw new ArgumentException("Expected exactly 2 string arguments.");
        }

        object? left = args.Parameters.Evaluate(0);
        object? right = args.Parameters.Evaluate(1);

        // A literal null operand short-circuits the same way a null from the scope does.
        if (left is null || right is null)
        {
            throw new NullOperandException();
        }

        return op(Convert.ToString(left)!, Convert.ToString(right)!);
    }

    // ─── Sentinel exceptions ──────────────────────────────────────────────────
    // Internal control flow only; none of these escape Evaluate.

    private sealed class NullOperandException : Exception;

    private sealed class DisallowedFunctionException(string functionName) : Exception
    {
        public string FunctionName { get; } = functionName;
    }

    private sealed class UnknownPathException(string path) : Exception
    {
        public string Path { get; } = path;
    }
}
