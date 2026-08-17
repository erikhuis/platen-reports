using System.Globalization;

namespace PlatenReports;

/// <summary>
/// Resolves dotted paths ("workOrder.assetCode") against the report data tree. Missing
/// segments resolve to null — never throw — so a definition can reference fields the data
/// happens not to carry (renders as the element's emptyText / blank). Inside table rows the
/// scope is the row item with fallthrough to the document root, so cell templates can mix
/// row fields with header fields.
/// </summary>
public static class ReportPathBinder
{
    public static object? Resolve(IReadOnlyDictionary<string, object?> scope, string path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            return null;
        }

        object? current = scope;
        foreach (var segment in path.Split('.'))
        {
            if (current is not IReadOnlyDictionary<string, object?> dict)
            {
                return null;
            }

            if (!dict.TryGetValue(segment, out current))
            {
                return null;
            }
        }

        return current;
    }

    public static object? Resolve(
        IReadOnlyDictionary<string, object?> scope,
        IReadOnlyDictionary<string, object?>? root,
        string path)
    {
        var value = Resolve(scope, path);
        if (value is null && root is not null && !ReferenceEquals(scope, root))
        {
            value = Resolve(root, path);
        }

        return value;
    }

    /// <summary>
    /// Formats a bound value for print. Culture is fixed to invariant-with-locale-dates via the
    /// supplied culture so numbers/dates in a report don't depend on the server's OS locale.
    /// When <paramref name="timeZone"/> is set, UTC date-times (what EF hands us) are converted
    /// to it first so body values print in the caller's zone, like the footer stamp. A bad format
    /// string — overlay authors write these — degrades to the unformatted rendering, never throws.
    /// </summary>
    public static string Format(object? value, string? format, CultureInfo culture, TimeZoneInfo? timeZone = null)
    {
        value = ConvertToZone(value, timeZone);
        switch (value)
        {
            case null:
                return string.Empty;
            case bool b:
                return b ? "✓" : "—";
            case IFormattable formattable when !string.IsNullOrEmpty(format):
                try
                {
                    return formattable.ToString(format, culture);
                }
                catch (FormatException)
                {
                    return FormatDefault(formattable, culture);
                }
            case IFormattable formattable:
                return FormatDefault(formattable, culture);
            default:
                return value.ToString() ?? string.Empty;
        }
    }

    private static string FormatDefault(IFormattable formattable, CultureInfo culture) => formattable switch
    {
        DateTime dt => dt.ToString("g", culture),
        DateTimeOffset dto => dto.ToString("g", culture),
        DateOnly d => d.ToString("d", culture),
        _ => formattable.ToString(null, culture),
    };

    /// <summary>Only unambiguously-UTC values are converted; unspecified/local kinds pass through untouched.</summary>
    private static object? ConvertToZone(object? value, TimeZoneInfo? timeZone)
    {
        if (timeZone is null)
        {
            return value;
        }

        return value switch
        {
            DateTime { Kind: DateTimeKind.Utc } dt => TimeZoneInfo.ConvertTimeFromUtc(dt, timeZone),
            DateTimeOffset dto => TimeZoneInfo.ConvertTime(dto, timeZone),
            _ => value,
        };
    }

    /// <summary>
    /// Flattens the scalar leaves of a scope to dotted keys ("workOrder.status" → value) for
    /// NCalc visibility conditions. Collections are skipped (conditions target scalars) and
    /// depth is capped so pathological trees cannot blow up per-row evaluation.
    /// </summary>
    public static IReadOnlyDictionary<string, object?> FlattenForConditions(
        IReadOnlyDictionary<string, object?> scope, int maxDepth = 4)
    {
        var flat = new Dictionary<string, object?>(StringComparer.Ordinal);
        Flatten(scope, prefix: null, depth: 0, maxDepth, flat);
        return flat;
    }

    private static void Flatten(
        IReadOnlyDictionary<string, object?> node, string? prefix, int depth, int maxDepth,
        Dictionary<string, object?> into)
    {
        if (depth > maxDepth)
        {
            return;
        }

        foreach (var (key, value) in node)
        {
            var path = prefix is null ? key : $"{prefix}.{key}";
            switch (value)
            {
                case IReadOnlyDictionary<string, object?> child:
                    Flatten(child, path, depth + 1, maxDepth, into);
                    break;
                case System.Collections.IEnumerable and not string:
                    break; // collections are not addressable from visibility conditions
                default:
                    into[path] = value;
                    break;
            }
        }
    }
}
