using System.Collections;
using System.Collections.Concurrent;
using System.Reflection;
using System.Text.Json;

namespace PlatenReports;

/// <summary>
/// The data a report renders against: a nested dictionary tree — scalars, child dictionaries,
/// lists of dictionaries — keyed with camelCase names.
/// </summary>
/// <remarks>
/// One shape feeds all three consumers: the dotted-path binder, text templates and visibility
/// conditions. It is also the entire data contract of the engine — nothing below this type
/// knows where the values came from, which is why a data provider can be backed by SQL, an
/// ORM, an HTTP call or a literal dictionary without the engine changing.
/// </remarks>
/// <param name="Root">The tree root.</param>
public sealed record ReportDataContext(IReadOnlyDictionary<string, object?> Root)
{
    /// <summary>An empty context.</summary>
    public static readonly ReportDataContext Empty = new(new Dictionary<string, object?>());
}

/// <summary>
/// Builds the dictionary tree from plain objects via reflection, with camelCase keys and
/// cached property metadata.
/// </summary>
/// <remarks>
/// A convenience for providers that already have DTOs and would rather not hand-write
/// dictionaries. Depth-capped as a cycle guard: pass acyclic data. Objects with lazy or
/// self-referencing navigation properties do not belong here.
/// </remarks>
public static class ReportDataTreeBuilder
{
    private const int MaxDepth = 6;

    private static readonly ConcurrentDictionary<Type, PropertyInfo[]> PropertyCache = new();

    /// <summary>Converts one object into a data-tree node.</summary>
    /// <param name="dto">The object to convert.</param>
    /// <returns>Its properties as a camelCase-keyed dictionary.</returns>
    public static IReadOnlyDictionary<string, object?> Build(object dto) =>
        (IReadOnlyDictionary<string, object?>)(Convert(dto, 0) ?? new Dictionary<string, object?>());

    /// <summary>Converts a sequence into a list of data-tree nodes.</summary>
    /// <param name="items">The items to convert.</param>
    /// <returns>The converted items, in order.</returns>
    public static IReadOnlyList<object?> BuildList(IEnumerable items) =>
        items.Cast<object?>().Select(i => Convert(i, 0)).ToList();

    private static object? Convert(object? value, int depth)
    {
        switch (value)
        {
            case null:
                return null;
            case string or bool or Guid:
                return value;
            case DateTime or DateTimeOffset or DateOnly or TimeOnly or TimeSpan:
                return value; // scalar set matches the field describer's notion of a scalar
            case Enum e:
                return e.ToString();
            case JsonElement json:
                return json.ToString();
            default:
                var type = value.GetType();
                if (type.IsPrimitive || value is decimal)
                {
                    return value;
                }

                if (depth >= MaxDepth)
                {
                    return value.ToString();
                }

                if (value is IDictionary dictionary)
                {
                    var dict = new Dictionary<string, object?>(StringComparer.Ordinal);
                    foreach (DictionaryEntry entry in dictionary)
                    {
                        dict[CamelCase(entry.Key.ToString() ?? string.Empty)] = Convert(entry.Value, depth + 1);
                    }

                    return dict;
                }

                if (value is IEnumerable enumerable)
                {
                    return enumerable.Cast<object?>().Select(i => Convert(i, depth + 1)).ToList();
                }

                var properties = PropertyCache.GetOrAdd(type, static t =>
                    t.GetProperties(BindingFlags.Public | BindingFlags.Instance)
                        .Where(p => p.CanRead && p.GetIndexParameters().Length == 0)
                        .ToArray());

                var result = new Dictionary<string, object?>(StringComparer.Ordinal);
                foreach (var property in properties)
                {
                    result[CamelCase(property.Name)] = Convert(property.GetValue(value), depth + 1);
                }

                return result;
        }
    }

    private static string CamelCase(string name) =>
        name.Length == 0 || char.IsLower(name[0]) ? name : char.ToLowerInvariant(name[0]) + name[1..];
}
