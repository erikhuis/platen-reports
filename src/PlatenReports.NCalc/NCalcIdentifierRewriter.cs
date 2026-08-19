using System.Text;

namespace PlatenReports.NCalc;

/// <summary>
/// Rewrites dotted identifiers into NCalc's bracket form so the parser accepts them.
/// </summary>
/// <remarks>
/// <para><b>This is a deliberate copy.</b> The origin codebase shares one implementation between
/// its workflow rules engine and its reporting conditions. Only the reporting half belongs in this
/// package, and the alternatives were both worse: publish a shared-helper package for one small
/// function, or couple a workflow engine to a reporting package. So the origin keeps its copy and
/// this package owns this one. They are expected to drift, and that is fine — nothing here is a
/// wire format, and the two callers have different futures.</para>
/// <para>Internal to the package: the rewriting is an implementation detail of how conditions
/// reach NCalc, not something a host should depend on.</para>
/// </remarks>
internal static class NCalcIdentifierRewriter
{
    /// <summary>
    /// Rewrites dotted identifiers (e.g. <c>entity.ActualCost</c>) into NCalc's bracket form
    /// (<c>[entity.ActualCost]</c>) so the parser accepts them. String literals and
    /// already-bracketed identifiers are passed through untouched.
    /// </summary>
    internal static string WrapDottedIdentifiers(string expression)
    {
        var sb = new StringBuilder(expression.Length + 16);
        int i = 0;

        while (i < expression.Length)
        {
            char c = expression[i];

            // Preserve string literals verbatim. Both single and double quotes are NCalc literals.
            if (c == '\'' || c == '"')
            {
                char quote = c;
                sb.Append(c);
                i++;
                while (i < expression.Length && expression[i] != quote)
                {
                    if (expression[i] == '\\' && i + 1 < expression.Length)
                    {
                        sb.Append(expression[i]);
                        i++;
                    }
                    sb.Append(expression[i]);
                    i++;
                }
                if (i < expression.Length)
                {
                    sb.Append(expression[i]); // closing quote
                    i++;
                }
                continue;
            }

            // Preserve existing bracketed identifiers [foo.bar] verbatim.
            if (c == '[')
            {
                while (i < expression.Length && expression[i] != ']')
                {
                    sb.Append(expression[i]);
                    i++;
                }
                if (i < expression.Length)
                {
                    sb.Append(expression[i]);
                    i++;
                }
                continue;
            }

            // Try to match an identifier possibly followed by `.identifier` segments.
            if (char.IsLetter(c) || c == '_')
            {
                int start = i;
                while (i < expression.Length && IsIdentCharOrDot(expression[i]))
                {
                    i++;
                }
                string token = expression.AsSpan(start, i - start).ToString();
                if (token.Contains('.') && !LooksLikeNumber(token))
                {
                    sb.Append('[').Append(token).Append(']');
                }
                else
                {
                    sb.Append(token);
                }
                continue;
            }

            sb.Append(c);
            i++;
        }

        return sb.ToString();
    }

    private static bool IsIdentCharOrDot(char c) =>
        char.IsLetterOrDigit(c) || c == '_' ||
        // Only consume a dot if it is followed by another identifier character (keeps `.5` etc. alone).
        c == '.';

    private static bool LooksLikeNumber(string token) => token.Length > 0 && char.IsDigit(token[0]);
}
