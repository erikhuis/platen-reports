using System.Collections;
using System.Reflection;

namespace PlatenReports;

/// <summary>
/// Derives a <see cref="ReportFieldNode"/> tree from a DTO type with the same reflection
/// rules (camelCase keys, scalar classification, depth cap) as <see cref="ReportDataTreeBuilder"/> —
/// so a provider's DescribeFields() cannot drift from what its LoadAsync actually emits.
/// </summary>
public static class ReportFieldDescriber
{
    private const int MaxDepth = 4;

    public static IReadOnlyList<ReportFieldNode> FromType(Type dtoType) => Describe(dtoType, 0);

    public static ReportFieldNode ObjectOf(string name, Type dtoType, params ReportFieldNode[] extraChildren)
    {
        var children = Describe(dtoType, 0).Concat(extraChildren).ToArray();
        return new ReportFieldNode(name, "object", false, children);
    }

    public static ReportFieldNode CollectionOf(string name, Type itemDtoType) =>
        new(name, "collection", true, Describe(itemDtoType, 0));

    /// <summary>The meta node the orchestrator injects into every report's data context.</summary>
    public static ReportFieldNode MetaNode() => ReportFieldNode.Object(
        "meta",
        ReportFieldNode.Scalar("tenantName"),
        ReportFieldNode.Scalar("generatedAt", "date"),
        ReportFieldNode.Scalar("generatedAtLocal", "date"),
        ReportFieldNode.Scalar("timeZone"),
        ReportFieldNode.Scalar("locale"),
        ReportFieldNode.Scalar("reportTitle"));

    private static IReadOnlyList<ReportFieldNode> Describe(Type type, int depth)
    {
        if (depth >= MaxDepth)
        {
            return [];
        }

        var nodes = new List<ReportFieldNode>();
        foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance)
                     .Where(p => p.CanRead && p.GetIndexParameters().Length == 0))
        {
            var name = CamelCase(property.Name);
            var propertyType = Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType;

            if (IsScalar(propertyType))
            {
                nodes.Add(new ReportFieldNode(name, ScalarKind(propertyType)));
            }
            else if (TryGetEnumerableItemType(propertyType, out var itemType))
            {
                nodes.Add(new ReportFieldNode(
                    name, "collection", true,
                    IsScalar(itemType) ? [] : Describe(itemType, depth + 1)));
            }
            else
            {
                nodes.Add(new ReportFieldNode(name, "object", false, Describe(propertyType, depth + 1)));
            }
        }

        return nodes;
    }

    private static bool IsScalar(Type type) =>
        type.IsPrimitive || type.IsEnum
        || type == typeof(string) || type == typeof(decimal) || type == typeof(Guid)
        || type == typeof(DateTime) || type == typeof(DateTimeOffset)
        || type == typeof(DateOnly) || type == typeof(TimeOnly) || type == typeof(TimeSpan);

    private static string ScalarKind(Type type)
    {
        if (type == typeof(bool))
        {
            return "bool";
        }

        if (type == typeof(Guid))
        {
            return "guid";
        }

        if (type == typeof(DateTime) || type == typeof(DateTimeOffset) || type == typeof(DateOnly))
        {
            return "date";
        }

        if (type == typeof(string) || type.IsEnum || type == typeof(TimeOnly) || type == typeof(TimeSpan))
        {
            return "string";
        }

        return "number";
    }

    private static bool TryGetEnumerableItemType(Type type, out Type itemType)
    {
        itemType = typeof(object);
        if (type == typeof(string) || !typeof(IEnumerable).IsAssignableFrom(type))
        {
            return false;
        }

        var enumerableInterface = type.IsGenericType && type.GetGenericTypeDefinition() == typeof(IEnumerable<>)
            ? type
            : type.GetInterfaces().FirstOrDefault(i =>
                i.IsGenericType && i.GetGenericTypeDefinition() == typeof(IEnumerable<>));
        if (enumerableInterface is null)
        {
            return false;
        }

        itemType = enumerableInterface.GetGenericArguments()[0];
        return true;
    }

    private static string CamelCase(string name) =>
        name.Length == 0 || char.IsLower(name[0]) ? name : char.ToLowerInvariant(name[0]) + name[1..];
}
