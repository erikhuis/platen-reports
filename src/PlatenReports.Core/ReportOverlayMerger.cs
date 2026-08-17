using System.Text.Json.Nodes;
using PlatenReports.Model;

namespace PlatenReports;

/// <summary>
/// Merges a customisation overlay patch over a published report definition at render time.
///
/// Deterministic order: <b>suppress → insert (document order) → setProps</b> — setProps runs
/// last so it can restyle inserted elements. Every patch that cannot be applied (unknown id,
/// unresolvable anchor, id collision, disallowed prop) yields an <see cref="OverlayMergeWarning"/>
/// and is skipped; the merge itself never fails. That is what lets a host publish a new
/// definition while existing customisations keep applying.
///
/// Anchors resolve against element ids, table column ids and keyValueGrid pair ids. The
/// pseudo-anchor <c>$body</c> addresses the top-level body array (appendInto only).
/// </summary>
public static class ReportOverlayMerger
{
    public const string BodyPseudoAnchor = "$body";

    /// <summary>Prop roots an overlay may override via setProps. 'style.*' leaves are also allowed.</summary>
    private static readonly HashSet<string> SetPropsAllowedRoots = new(StringComparer.Ordinal)
    {
        "text", "template", "format", "emptyText", "visibleIf", "header", "label", "title",
        "height", "thickness", "weight", "width", "align", "spacing", "color", "groupBy",
        // Display-level props like align/spacing: an overlay author may
        // toggle whether a table header repeats across page breaks.
        "repeatHeader",
        // Render a bound field's value as markdown-lite.
        "markdown",
    };

    /// <summary>
    /// The patch keys plus the metadata carried on the document itself: schemaVersion and
    /// reportKey are part of the editor's default skeleton, baseVersion is stamped by
    /// PutOverlayAsync. Case-sensitive on purpose: "supress"/"setprops" typos must
    /// surface as errors, not be silently ignored.
    /// </summary>
    private static readonly HashSet<string> KnownOverlayKeys = new(StringComparer.Ordinal)
    {
        "suppress", "insert", "setProps", "schemaVersion", "baseVersion", "reportKey",
    };

    public sealed record MergeResult(JsonObject Merged, IReadOnlyList<OverlayMergeWarning> Warnings);

    /// <summary>
    /// Validates the structural shape of an overlay document. Fatal problems (not an object,
    /// malformed patch entries) are returned as errors — the caller rejects the PUT. Merge-time
    /// skips (unknown anchors etc.) are NOT errors; they surface as warnings from <see cref="Merge"/>.
    /// </summary>
    public static IReadOnlyList<string> ValidateOverlayShape(JsonObject overlay)
    {
        var errors = new List<string>();

        foreach (var (key, _) in overlay)
        {
            if (!KnownOverlayKeys.Contains(key))
            {
                errors.Add($"Unknown top-level key '{key}' — an overlay may contain 'suppress', 'insert' and 'setProps'.");
            }
        }

        if (overlay["suppress"] is JsonNode suppressNode)
        {
            if (suppressNode is not JsonArray suppress)
            {
                errors.Add("'suppress' must be an array of element ids.");
            }
            else
            {
                for (var i = 0; i < suppress.Count; i++)
                {
                    if (suppress[i] is not JsonValue v || !v.TryGetValue<string>(out _))
                    {
                        errors.Add($"suppress[{i}] must be a string id.");
                    }
                }
            }
        }

        if (overlay["insert"] is JsonNode insertNode)
        {
            if (insertNode is not JsonArray inserts)
            {
                errors.Add("'insert' must be an array of patch objects.");
            }
            else
            {
                for (var i = 0; i < inserts.Count; i++)
                {
                    if (inserts[i] is not JsonObject patch)
                    {
                        errors.Add($"insert[{i}] must be an object.");
                        continue;
                    }

                    if (GetString(patch, "anchor") is null)
                    {
                        errors.Add($"insert[{i}]: 'anchor' is required.");
                    }

                    var position = GetString(patch, "position");
                    if (position is not ("before" or "after" or "appendInto"))
                    {
                        errors.Add($"insert[{i}]: 'position' must be before, after or appendInto.");
                    }

                    if (patch["element"] is not JsonObject)
                    {
                        errors.Add($"insert[{i}]: 'element' object is required.");
                    }
                }
            }
        }

        if (overlay["setProps"] is JsonNode setPropsNode)
        {
            if (setPropsNode is not JsonArray setProps)
            {
                errors.Add("'setProps' must be an array of patch objects.");
            }
            else
            {
                for (var i = 0; i < setProps.Count; i++)
                {
                    if (setProps[i] is not JsonObject patch)
                    {
                        errors.Add($"setProps[{i}] must be an object.");
                        continue;
                    }

                    if (GetString(patch, "id") is null)
                    {
                        errors.Add($"setProps[{i}]: 'id' is required.");
                    }

                    if (patch["props"] is not JsonObject)
                    {
                        errors.Add($"setProps[{i}]: 'props' object is required.");
                    }
                }
            }
        }

        return errors;
    }

    public static MergeResult Merge(JsonObject standardDefinition, JsonObject? overlay)
    {
        var merged = (JsonObject)standardDefinition.DeepClone();
        if (overlay is null)
        {
            return new MergeResult(merged, []);
        }

        var warnings = new List<OverlayMergeWarning>();

        var standardVersion = GetString(merged, "version");
        var baseVersion = GetString(overlay, "baseVersion");
        if (baseVersion is not null && standardVersion is not null && baseVersion != standardVersion)
        {
            warnings.Add(new OverlayMergeWarning(
                OverlayMergeWarningCode.BaseVersionOutdated, null, null,
                $"Overlay was authored against standard version {baseVersion}; the current standard version is {standardVersion}. Review the customization."));
        }

        ApplySuppress(merged, overlay, warnings);
        ApplyInserts(merged, overlay, warnings);
        ApplySetProps(merged, overlay, warnings);

        return new MergeResult(merged, warnings);
    }

    private static void ApplySuppress(JsonObject merged, JsonObject overlay, List<OverlayMergeWarning> warnings)
    {
        if (overlay["suppress"] is not JsonArray suppress)
        {
            return;
        }

        foreach (var entry in suppress)
        {
            if (entry is not JsonValue value || !value.TryGetValue<string>(out var id))
            {
                continue;
            }

            var index = BuildIndex(merged);
            if (!index.TryGetValue(id, out var node))
            {
                warnings.Add(new OverlayMergeWarning(
                    OverlayMergeWarningCode.SuppressedIdNotFound, null, id,
                    $"suppress: no element with id '{id}' exists in the current standard definition."));
                continue;
            }

            if (GetSuppressBlockedReason(node, id) is { } blockedReason)
            {
                warnings.Add(new OverlayMergeWarning(
                    OverlayMergeWarningCode.SuppressBlocked, null, id, $"suppress: {blockedReason}"));
                continue;
            }

            node.Remove();
        }
    }

    /// <summary>
    /// Removing some nodes would leave a structurally invalid document (which the parser then
    /// rejects, falling the whole render back to the standard definition): a table's last
    /// column, a keyValueGrid's last pair, or a column that totals/groupTotals still reference.
    /// Returns the skip reason, or null when the suppress is safe.
    /// </summary>
    private static string? GetSuppressBlockedReason(IndexedNode target, string id)
    {
        if (target.ParentArray is not { } parentArray || parentArray.Parent is not JsonObject owner)
        {
            return null;
        }

        var listName = parentArray.GetPropertyName();
        var ownerType = GetString(owner, "type");
        if (listName == "columns" && ownerType == "table")
        {
            if (parentArray.Count <= 1)
            {
                return $"'{id}' is the last remaining column of its table; a table needs at least one column.";
            }

            if (IsColumnReferencedByTotals(owner, "totals", id) || IsColumnReferencedByTotals(owner, "groupTotals", id))
            {
                return $"column '{id}' is referenced by the table's totals/groupTotals; suppress or retarget those first.";
            }
        }
        else if (listName == "pairs" && ownerType == "keyValueGrid" && parentArray.Count <= 1)
        {
            return $"'{id}' is the last remaining pair of its keyValueGrid; a grid needs at least one pair.";
        }

        return null;
    }

    private static bool IsColumnReferencedByTotals(JsonObject table, string totalsProp, string columnId) =>
        table[totalsProp] is JsonArray totals && totals.OfType<JsonObject>()
            .Any(total => GetString(total, "columnId") == columnId);

    private static void ApplyInserts(JsonObject merged, JsonObject overlay, List<OverlayMergeWarning> warnings)
    {
        if (overlay["insert"] is not JsonArray inserts)
        {
            return;
        }

        foreach (var insertNode in inserts)
        {
            if (insertNode is not JsonObject patch)
            {
                continue;
            }

            var patchId = GetString(patch, "id");
            var anchor = GetString(patch, "anchor");
            var position = GetString(patch, "position");
            if (patch["element"] is not JsonObject element || anchor is null || position is null)
            {
                continue;
            }

            // Vet the payload before splicing: a structurally broken element must not be able
            // to take the whole report down at render time.
            var (elementErrors, elementIds) = ReportDefinitionParser.ValidateElementSubtree(element);
            if (elementErrors.Count > 0)
            {
                warnings.Add(new OverlayMergeWarning(
                    OverlayMergeWarningCode.InsertInvalidElement, patchId, anchor,
                    $"insert: element payload is invalid ({string.Join("; ", elementErrors)})."));
                continue;
            }

            // Re-index each round so later inserts can anchor on earlier ones.
            var index = BuildIndex(merged);

            var collision = elementIds.FirstOrDefault(id => index.ContainsKey(id));
            if (collision is not null)
            {
                warnings.Add(new OverlayMergeWarning(
                    OverlayMergeWarningCode.InsertIdCollision, patchId, collision,
                    $"insert: id '{collision}' already exists in the definition; patch skipped."));
                continue;
            }

            var payload = (JsonObject)element.DeepClone();

            if (anchor == BodyPseudoAnchor)
            {
                if (position != "appendInto")
                {
                    warnings.Add(new OverlayMergeWarning(
                        OverlayMergeWarningCode.InsertInvalidPosition, patchId, anchor,
                        "insert: the $body anchor only supports position 'appendInto'."));
                    continue;
                }

                if (merged["body"] is not JsonArray body)
                {
                    body = [];
                    merged["body"] = body;
                }

                body.Add(payload);
                continue;
            }

            if (!index.TryGetValue(anchor, out var target))
            {
                warnings.Add(new OverlayMergeWarning(
                    OverlayMergeWarningCode.InsertAnchorNotFound, patchId, anchor,
                    $"insert: anchor '{anchor}' does not exist in the current standard definition."));
                continue;
            }

            if (position == "appendInto")
            {
                var type = GetString(target.Node, "type");
                if (type is not ("row" or "column" or "container"))
                {
                    warnings.Add(new OverlayMergeWarning(
                        OverlayMergeWarningCode.InsertInvalidTarget, patchId, anchor,
                        $"insert: appendInto requires a row/column/container element; '{anchor}' is '{type ?? "unknown"}'."));
                    continue;
                }

                if (target.Node["children"] is not JsonArray children)
                {
                    children = [];
                    target.Node["children"] = children;
                }

                children.Add(payload);
                continue;
            }

            // before / after — anchor must live in an array (body, children, columns or pairs).
            if (target.ParentArray is null)
            {
                warnings.Add(new OverlayMergeWarning(
                    OverlayMergeWarningCode.InsertInvalidTarget, patchId, anchor,
                    $"insert: anchor '{anchor}' is a fixed slot (pageHeader/pageFooter) and does not support before/after."));
                continue;
            }

            var anchorIndex = target.ParentArray.IndexOf(target.Node);
            if (anchorIndex < 0)
            {
                continue; // stale index — should not happen, skip defensively
            }

            target.ParentArray.Insert(position == "before" ? anchorIndex : anchorIndex + 1, payload);
        }
    }

    private static void ApplySetProps(JsonObject merged, JsonObject overlay, List<OverlayMergeWarning> warnings)
    {
        if (overlay["setProps"] is not JsonArray setProps)
        {
            return;
        }

        var index = BuildIndex(merged);
        foreach (var patchNode in setProps)
        {
            if (patchNode is not JsonObject patch)
            {
                continue;
            }

            var id = GetString(patch, "id");
            if (id is null || patch["props"] is not JsonObject props)
            {
                continue;
            }

            if (!index.TryGetValue(id, out var target))
            {
                warnings.Add(new OverlayMergeWarning(
                    OverlayMergeWarningCode.SetPropsIdNotFound, id, id,
                    $"setProps: no element with id '{id}' exists in the current standard definition."));
                continue;
            }

            foreach (var (propPath, value) in props)
            {
                if (!IsAllowedPropPath(propPath))
                {
                    warnings.Add(new OverlayMergeWarning(
                        OverlayMergeWarningCode.SetPropsDisallowedProp, id, id,
                        $"setProps: property '{propPath}' may not be overridden by an overlay."));
                    continue;
                }

                AssignPropPath(target.Node, propPath, value?.DeepClone());
            }
        }
    }

    /// <summary>
    /// Structural identity, id renames and page setup stay owned by the standard definition;
    /// overlay authors override presentation and content leaves only.
    /// </summary>
    internal static bool IsAllowedPropPath(string propPath)
    {
        if (string.IsNullOrWhiteSpace(propPath))
        {
            return false;
        }

        var root = propPath.Split('.', 2)[0];
        if (root == "style")
        {
            return true; // 'style' object or any 'style.<leaf>'
        }
        // Everything else must be a single allowed leaf ('text', 'format', …). Values may be
        // whole locale maps; dotted paths into them are unnecessary and not supported.
        return !propPath.Contains('.', StringComparison.Ordinal) && SetPropsAllowedRoots.Contains(root);
    }

    private static void AssignPropPath(JsonObject target, string propPath, JsonNode? value)
    {
        var segments = propPath.Split('.');
        var current = target;
        for (var i = 0; i < segments.Length - 1; i++)
        {
            if (current[segments[i]] is not JsonObject next)
            {
                next = [];
                current[segments[i]] = next;
            }

            current = next;
        }

        current[segments[^1]] = value;
    }

    /// <summary>
    /// Node handle with enough parent context to remove or insert-relative-to it. Elements in
    /// arrays (body, children, columns, pairs) carry <see cref="ParentArray"/>; the fixed
    /// pageHeader/pageFooter slots carry the owning object + property name instead.
    /// </summary>
    private sealed record IndexedNode(JsonObject Node, JsonArray? ParentArray, JsonObject? SlotOwner, string? SlotName)
    {
        public void Remove()
        {
            if (ParentArray is not null)
            {
                ParentArray.Remove(Node);
            }
            else
            {
                SlotOwner?.Remove(SlotName!);
            }
        }
    }

    private static Dictionary<string, IndexedNode> BuildIndex(JsonObject document)
    {
        var index = new Dictionary<string, IndexedNode>(StringComparer.Ordinal);

        if (document["pageHeader"] is JsonObject header)
        {
            Collect(header, new IndexedNode(header, null, document, "pageHeader"), index);
        }

        if (document["body"] is JsonArray body)
        {
            foreach (var child in body.OfType<JsonObject>().ToList())
            {
                Collect(child, new IndexedNode(child, body, null, null), index);
            }
        }

        if (document["pageFooter"] is JsonObject footer)
        {
            Collect(footer, new IndexedNode(footer, null, document, "pageFooter"), index);
        }

        return index;
    }

    private static void Collect(JsonObject node, IndexedNode handle, Dictionary<string, IndexedNode> index)
    {
        if (GetString(node, "id") is { } id)
        {
            index.TryAdd(id, handle);
        }

        foreach (var childListName in (string[])["children", "columns", "pairs"])
        {
            if (node[childListName] is not JsonArray childArray)
            {
                continue;
            }

            foreach (var child in childArray.OfType<JsonObject>().ToList())
            {
                Collect(child, new IndexedNode(child, childArray, null, null), index);
            }
        }
    }

    private static string? GetString(JsonObject obj, string name) =>
        obj[name] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
}
