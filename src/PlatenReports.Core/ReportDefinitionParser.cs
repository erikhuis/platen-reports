using System.Text.Json;
using System.Text.Json.Nodes;
using PlatenReports.Model;

namespace PlatenReports;

/// <summary>
/// Parses and validates a report-definition JSON document into the typed
/// <see cref="ReportDocumentModel"/>.
///
/// Validation is strict: element ids must be present and unique, element types known, and
/// required per-type props present. Merged documents are re-validated after every overlay
/// merge — the merger refuses patches that would break structure, so a parse failure at that
/// point signals a bug, and the render path falls back to the published definition.
/// </summary>
public static class ReportDefinitionParser
{
    private static readonly HashSet<string> KnownPageSizes = new(StringComparer.OrdinalIgnoreCase) { "A4", "Letter" };
    private static readonly HashSet<string> KnownOrientations = new(StringComparer.OrdinalIgnoreCase) { "portrait", "landscape" };
    private static readonly HashSet<string> KnownAligns = new(StringComparer.OrdinalIgnoreCase) { "left", "center", "right" };
    private static readonly HashSet<string> KnownParameterTypes = new(StringComparer.OrdinalIgnoreCase)
        { "guid", "string", "int", "decimal", "date", "bool" };

    public static ReportDocumentModel Parse(string json)
    {
        JsonNode? node;
        try
        {
            node = JsonNode.Parse(json);
        }
        catch (JsonException ex)
        {
            throw new ReportValidationException($"Document is not valid JSON: {ex.Message}");
        }

        if (node is not JsonObject obj)
        {
            throw new ReportValidationException("Document root must be a JSON object.");
        }

        return Parse(obj);
    }

    public static ReportDocumentModel Parse(JsonObject document)
    {
        var errors = new List<string>();
        var seenIds = new HashSet<string>(StringComparer.Ordinal);

        // A supported SET, never a single value compared for equality: an engine must be able
        // to accept a range and lift older documents in memory. See docs/schema-version.md.
        var schemaVersion = GetInt(document, "schemaVersion");
        if (schemaVersion is null || !PlatenReportsInfo.SupportsSchemaVersion(schemaVersion.Value))
        {
            errors.Add(
                $"Unsupported schemaVersion '{schemaVersion?.ToString() ?? "(missing)"}' — supported: "
                + string.Join(", ", PlatenReportsInfo.SupportedSchemaVersions.Order()) + ".");
        }

        var key = GetString(document, "key");
        if (string.IsNullOrWhiteSpace(key))
        {
            errors.Add("'key' is required.");
        }

        var version = GetString(document, "version");
        if (string.IsNullOrWhiteSpace(version))
        {
            errors.Add("'version' is required.");
        }

        var dataSource = GetString(document, "dataSource");
        if (string.IsNullOrWhiteSpace(dataSource))
        {
            errors.Add("'dataSource' is required.");
        }

        var title = ParseLocalizedText(document["title"], "title", errors) ?? LocalizedText.Empty;
        var page = ParsePageSetup(document["page"], errors);
        var defaultStyle = ParseStyle(document["style"] ?? document["defaultStyle"], "defaultStyle", errors);
        var parameters = ParseParameters(document["parameters"], errors);

        ReportElement? pageHeader = null;
        if (document["pageHeader"] is JsonObject headerObj)
        {
            pageHeader = ParseElement(headerObj, "pageHeader", allowPageNumber: true, seenIds, errors);
        }
        else if (document["pageHeader"] is not null)
        {
            errors.Add("'pageHeader' must be an element object.");
        }

        var body = new List<ReportElement>();
        if (document["body"] is JsonArray bodyArray)
        {
            for (var i = 0; i < bodyArray.Count; i++)
            {
                if (bodyArray[i] is JsonObject el)
                {
                    var parsed = ParseElement(el, $"body[{i}]", allowPageNumber: false, seenIds, errors);
                    if (parsed is not null)
                    {
                        body.Add(parsed);
                    }
                }
                else
                {
                    errors.Add($"body[{i}] must be an element object.");
                }
            }
        }
        else if (document["body"] is not null)
        {
            errors.Add("'body' must be an array of elements.");
        }

        ReportElement? pageFooter = null;
        if (document["pageFooter"] is JsonObject footerObj)
        {
            pageFooter = ParseElement(footerObj, "pageFooter", allowPageNumber: true, seenIds, errors);
        }
        else if (document["pageFooter"] is not null)
        {
            errors.Add("'pageFooter' must be an element object.");
        }

        if (errors.Count > 0)
        {
            throw new ReportValidationException(errors);
        }

        return new ReportDocumentModel
        {
            Key = key!,
            Version = version!,
            Title = title,
            DataSource = dataSource!,
            RequiredPermission = GetString(document, "requiredPermission"),
            Page = page,
            DefaultStyle = defaultStyle,
            Parameters = parameters,
            PageHeader = pageHeader,
            Body = body,
            PageFooter = pageFooter,
        };
    }

    /// <summary>
    /// Validates a single element subtree (used by the overlay merger to vet inserted
    /// elements before splicing them into the tree). Returns the validation errors instead
    /// of throwing, plus every id the subtree declares.
    /// </summary>
    public static (IReadOnlyList<string> Errors, IReadOnlyList<string> Ids) ValidateElementSubtree(JsonObject element)
    {
        var errors = new List<string>();
        var seenIds = new HashSet<string>(StringComparer.Ordinal);
        ParseElement(element, "element", allowPageNumber: true, seenIds, errors);
        return (errors, seenIds.ToList());
    }

    private static ReportElement? ParseElement(
        JsonObject el, string where, bool allowPageNumber, HashSet<string> seenIds, List<string> errors)
    {
        var id = GetString(el, "id");
        if (string.IsNullOrWhiteSpace(id))
        {
            errors.Add($"{where}: element is missing required 'id'.");
            id = $"(missing:{where})";
        }
        else if (!seenIds.Add(id))
        {
            errors.Add($"{where}: duplicate element id '{id}'.");
        }

        var type = GetString(el, "type");
        if (string.IsNullOrWhiteSpace(type))
        {
            errors.Add($"{where} (id '{id}'): element is missing required 'type'.");
            return null;
        }

        var style = ParseStyle(el["style"], $"{where}.style", errors);
        var visibleIf = GetString(el, "visibleIf");
        var weight = GetDouble(el, "weight");
        var width = GetDouble(el, "width");

        switch (type)
        {
            case "text":
                {
                    var text = ParseLocalizedText(el["text"], $"{where}.text", errors);
                    if (text is null)
                    {
                        errors.Add($"{where} (id '{id}'): 'text' is required for type 'text'.");
                    }

                    return new TextElement
                    {
                        Id = id!,
                        VisibleIf = visibleIf,
                        Style = style,
                        Weight = weight,
                        Width = width,
                        Text = text ?? LocalizedText.Empty,
                    };
                }
            case "field":
                {
                    var path = GetString(el, "path");
                    if (string.IsNullOrWhiteSpace(path))
                    {
                        errors.Add($"{where} (id '{id}'): 'path' is required for type 'field'.");
                    }

                    return new FieldElement
                    {
                        Id = id!,
                        VisibleIf = visibleIf,
                        Style = style,
                        Weight = weight,
                        Width = width,
                        Path = path ?? string.Empty,
                        Format = GetString(el, "format"),
                        EmptyText = ParseLocalizedText(el["emptyText"], $"{where}.emptyText", errors),
                        Markdown = GetBool(el, "markdown") ?? false,
                    };
                }
            case "row":
            case "column":
                {
                    var children = new List<ReportElement>();
                    if (el["children"] is JsonArray childArray)
                    {
                        for (var i = 0; i < childArray.Count; i++)
                        {
                            if (childArray[i] is JsonObject child)
                            {
                                var parsed = ParseElement(child, $"{where}.children[{i}]", allowPageNumber, seenIds, errors);
                                if (parsed is not null)
                                {
                                    children.Add(parsed);
                                }
                            }
                            else
                            {
                                errors.Add($"{where}.children[{i}] must be an element object.");
                            }
                        }
                    }

                    if (type == "row")
                    {
                        return new RowElement { Id = id!, VisibleIf = visibleIf, Style = style, Weight = weight, Width = width, Children = children };
                    }

                    return new ColumnElement
                    {
                        Id = id!,
                        VisibleIf = visibleIf,
                        Style = style,
                        Weight = weight,
                        Width = width,
                        Children = children,
                        Spacing = GetDouble(el, "spacing"),
                    };
                }
            case "container":
                {
                    // On a container, 'width' is the layout mode ("full"|"half"), not fixed points —
                    // GetDouble above yields null for the string value, so there is no conflict.
                    var widthMode = GetString(el, "width") ?? "full";
                    if (widthMode is not ("full" or "half"))
                    {
                        errors.Add($"{where} (id '{id}'): container width must be 'full' or 'half'.");
                        widthMode = "full";
                    }

                    var children = new List<ReportElement>();
                    if (el["children"] is JsonArray containerChildren)
                    {
                        for (var i = 0; i < containerChildren.Count; i++)
                        {
                            if (containerChildren[i] is JsonObject child)
                            {
                                var parsed = ParseElement(child, $"{where}.children[{i}]", allowPageNumber, seenIds, errors);
                                if (parsed is not null)
                                {
                                    children.Add(parsed);
                                }
                            }
                            else
                            {
                                errors.Add($"{where}.children[{i}] must be an element object.");
                            }
                        }
                    }

                    return new ContainerElement
                    {
                        Id = id!,
                        VisibleIf = visibleIf,
                        Style = style,
                        Weight = weight,
                        Title = ParseLocalizedText(el["title"], $"{where}.title", errors),
                        WidthMode = widthMode,
                        Children = children,
                        Spacing = GetDouble(el, "spacing"),
                    };
                }
            case "table":
                return ParseTable(el, id!, where, visibleIf, style, weight, width, seenIds, errors);
            case "keyValueGrid":
                return ParseKeyValueGrid(el, id!, where, visibleIf, style, weight, width, seenIds, errors);
            case "spacer":
                return new SpacerElement
                {
                    Id = id!,
                    VisibleIf = visibleIf,
                    Style = style,
                    Weight = weight,
                    Width = width,
                    Height = GetDouble(el, "height") ?? 8,
                };
            case "line":
                return new LineElement
                {
                    Id = id!,
                    VisibleIf = visibleIf,
                    Style = style,
                    Weight = weight,
                    Width = width,
                    Thickness = GetDouble(el, "thickness") ?? 0.5,
                    Color = GetString(el, "color"),
                };
            case "image":
                {
                    var source = GetString(el, "source") ?? "tenantLogo";
                    if (source != "tenantLogo")
                    {
                        errors.Add($"{where} (id '{id}'): unsupported image source '{source}' — only 'tenantLogo' is supported.");
                    }

                    return new ImageElement
                    {
                        Id = id!,
                        VisibleIf = visibleIf,
                        Style = style,
                        Weight = weight,
                        Width = width,
                        Source = source,
                        Height = GetDouble(el, "height"),
                    };
                }
            case "pageNumber":
                {
                    if (!allowPageNumber)
                    {
                        errors.Add($"{where} (id '{id}'): 'pageNumber' is only allowed inside pageHeader/pageFooter.");
                    }

                    return new PageNumberElement
                    {
                        Id = id!,
                        VisibleIf = visibleIf,
                        Style = style,
                        Weight = weight,
                        Width = width,
                        Template = GetString(el, "template") ?? "{page} / {total}",
                    };
                }
            default:
                errors.Add($"{where} (id '{id}'): unknown element type '{type}'.");
                return null;
        }
    }

    private static TableElement ParseTable(
        JsonObject el, string id, string where, string? visibleIf, ReportStyle? style,
        double? weight, double? width, HashSet<string> seenIds, List<string> errors)
    {
        var bind = GetString(el, "bind");
        if (string.IsNullOrWhiteSpace(bind))
        {
            errors.Add($"{where} (id '{id}'): 'bind' is required for type 'table'.");
        }

        var columns = new List<TableColumnDefinition>();
        if (el["columns"] is JsonArray columnArray)
        {
            for (var i = 0; i < columnArray.Count; i++)
            {
                if (columnArray[i] is not JsonObject col)
                {
                    errors.Add($"{where}.columns[{i}] must be an object.");
                    continue;
                }

                var colId = GetString(col, "id");
                if (string.IsNullOrWhiteSpace(colId))
                {
                    errors.Add($"{where}.columns[{i}]: column is missing required 'id'.");
                }
                else if (!seenIds.Add(colId))
                {
                    errors.Add($"{where}.columns[{i}]: duplicate id '{colId}'.");
                }

                var path = GetString(col, "path");
                var template = ParseLocalizedText(col["template"], $"{where}.columns[{i}].template", errors);
                if (string.IsNullOrWhiteSpace(path) && template is null)
                {
                    errors.Add($"{where}.columns[{i}] (id '{colId}'): either 'path' or 'template' is required.");
                }

                // Normalized to lowercase: the renderer matches "center"/"right" case-sensitively.
                var align = GetString(col, "align")?.ToLowerInvariant();
                if (align is not null && !KnownAligns.Contains(align))
                {
                    errors.Add($"{where}.columns[{i}] (id '{colId}'): invalid align '{align}'.");
                }

                columns.Add(new TableColumnDefinition
                {
                    Id = colId ?? $"(missing:{where}.columns[{i}])",
                    Header = ParseLocalizedText(col["header"], $"{where}.columns[{i}].header", errors) ?? LocalizedText.Empty,
                    Path = path,
                    Template = template,
                    Format = GetString(col, "format"),
                    Weight = GetDouble(col, "weight"),
                    Width = GetDouble(col, "width"),
                    Align = align,
                });
            }
        }

        if (columns.Count == 0)
        {
            errors.Add($"{where} (id '{id}'): a table needs at least one column.");
        }

        List<TableTotalDefinition> ParseTotals(JsonNode? node, string propName)
        {
            var parsed = new List<TableTotalDefinition>();
            if (node is not JsonArray totalsArray)
            {
                return parsed;
            }

            for (var i = 0; i < totalsArray.Count; i++)
            {
                if (totalsArray[i] is not JsonObject total)
                {
                    errors.Add($"{where}.{propName}[{i}] must be an object.");
                    continue;
                }

                var columnId = GetString(total, "columnId");
                var aggregate = GetString(total, "aggregate");
                if (string.IsNullOrWhiteSpace(columnId) || columns.All(c => c.Id != columnId))
                {
                    errors.Add($"{where}.{propName}[{i}]: 'columnId' must reference a column in this table.");
                }

                if (aggregate is not ("sum" or "count"))
                {
                    errors.Add($"{where}.{propName}[{i}]: 'aggregate' must be 'sum' or 'count'.");
                }

                parsed.Add(new TableTotalDefinition
                {
                    ColumnId = columnId ?? string.Empty,
                    Aggregate = aggregate ?? "sum",
                    Format = GetString(total, "format"),
                    Label = ParseLocalizedText(total["label"], $"{where}.{propName}[{i}].label", errors),
                });
            }

            return parsed;
        }

        var groupBy = GetString(el, "groupBy");
        var groupTotals = ParseTotals(el["groupTotals"], "groupTotals");
        if (groupTotals.Count > 0 && string.IsNullOrWhiteSpace(groupBy))
        {
            errors.Add($"{where} (id '{id}'): 'groupTotals' requires 'groupBy'.");
        }

        return new TableElement
        {
            Id = id,
            VisibleIf = visibleIf,
            Style = style,
            Weight = weight,
            Width = width,
            Bind = bind ?? string.Empty,
            Columns = columns,
            GroupBy = groupBy,
            Totals = ParseTotals(el["totals"], "totals"),
            GroupTotals = groupTotals,
            EmptyText = ParseLocalizedText(el["emptyText"], $"{where}.emptyText", errors),
            RepeatHeader = GetBool(el, "repeatHeader") ?? true,
        };
    }

    private static KeyValueGridElement ParseKeyValueGrid(
        JsonObject el, string id, string where, string? visibleIf, ReportStyle? style,
        double? weight, double? width, HashSet<string> seenIds, List<string> errors)
    {
        var pairs = new List<KeyValuePairDefinition>();
        if (el["pairs"] is JsonArray pairArray)
        {
            for (var i = 0; i < pairArray.Count; i++)
            {
                if (pairArray[i] is not JsonObject pair)
                {
                    errors.Add($"{where}.pairs[{i}] must be an object.");
                    continue;
                }

                var pairId = GetString(pair, "id");
                if (string.IsNullOrWhiteSpace(pairId))
                {
                    errors.Add($"{where}.pairs[{i}]: pair is missing required 'id'.");
                }
                else if (!seenIds.Add(pairId))
                {
                    errors.Add($"{where}.pairs[{i}]: duplicate id '{pairId}'.");
                }

                var path = GetString(pair, "path");
                var template = ParseLocalizedText(pair["template"], $"{where}.pairs[{i}].template", errors);
                if (string.IsNullOrWhiteSpace(path) && template is null)
                {
                    errors.Add($"{where}.pairs[{i}] (id '{pairId}'): either 'path' or 'template' is required.");
                }

                pairs.Add(new KeyValuePairDefinition
                {
                    Id = pairId ?? $"(missing:{where}.pairs[{i}])",
                    Label = ParseLocalizedText(pair["label"], $"{where}.pairs[{i}].label", errors) ?? LocalizedText.Empty,
                    Path = path,
                    Template = template,
                    Format = GetString(pair, "format"),
                    Markdown = GetBool(pair, "markdown") ?? false,
                });
            }
        }

        if (pairs.Count == 0)
        {
            errors.Add($"{where} (id '{id}'): a keyValueGrid needs at least one pair.");
        }

        var columns = GetInt(el, "columns") ?? 2;
        if (columns is not (1 or 2))
        {
            errors.Add($"{where} (id '{id}'): 'columns' must be 1 or 2.");
            columns = 2;
        }

        return new KeyValueGridElement
        {
            Id = id,
            VisibleIf = visibleIf,
            Style = style,
            Weight = weight,
            Width = width,
            Pairs = pairs,
            Columns = columns,
        };
    }

    private static ReportPageSetup ParsePageSetup(JsonNode? node, List<string> errors)
    {
        if (node is null)
        {
            return new ReportPageSetup();
        }

        if (node is not JsonObject obj)
        {
            errors.Add("'page' must be an object.");
            return new ReportPageSetup();
        }

        var size = GetString(obj, "size") ?? "A4";
        if (!KnownPageSizes.Contains(size))
        {
            errors.Add($"page.size '{size}' must be A4 or Letter.");
        }

        var orientation = GetString(obj, "orientation") ?? "portrait";
        if (!KnownOrientations.Contains(orientation))
        {
            errors.Add($"page.orientation '{orientation}' must be portrait or landscape.");
        }

        return new ReportPageSetup
        {
            Size = size,
            Orientation = orientation,
            Margin = GetDouble(obj, "margin") ?? 24,
        };
    }

    private static IReadOnlyList<ReportParameterDefinition> ParseParameters(JsonNode? node, List<string> errors)
    {
        if (node is null)
        {
            return [];
        }

        if (node is not JsonArray array)
        {
            errors.Add("'parameters' must be an array.");
            return [];
        }

        var parameters = new List<ReportParameterDefinition>();
        for (var i = 0; i < array.Count; i++)
        {
            if (array[i] is not JsonObject p)
            {
                errors.Add($"parameters[{i}] must be an object.");
                continue;
            }

            var name = GetString(p, "name");
            if (string.IsNullOrWhiteSpace(name))
            {
                errors.Add($"parameters[{i}]: 'name' is required.");
            }

            var type = GetString(p, "type") ?? "string";
            if (!KnownParameterTypes.Contains(type))
            {
                errors.Add($"parameters[{i}]: unknown type '{type}'.");
            }

            parameters.Add(new ReportParameterDefinition(
                name ?? string.Empty,
                type,
                GetBool(p, "required") ?? false,
                ParseLocalizedText(p["label"], $"parameters[{i}].label", errors)));
        }

        return parameters;
    }

    private static ReportStyle? ParseStyle(JsonNode? node, string where, List<string> errors)
    {
        if (node is null)
        {
            return null;
        }

        if (node is not JsonObject obj)
        {
            errors.Add($"{where} must be an object.");
            return null;
        }

        // Normalized to lowercase: the renderer matches "center"/"right" case-sensitively.
        var align = GetString(obj, "align")?.ToLowerInvariant();
        if (align is not null && !KnownAligns.Contains(align))
        {
            errors.Add($"{where}.align '{align}' must be left, center or right.");
        }

        return new ReportStyle
        {
            FontSize = GetDouble(obj, "fontSize"),
            Bold = GetBool(obj, "bold"),
            Italic = GetBool(obj, "italic"),
            Color = GetString(obj, "color"),
            BackgroundColor = GetString(obj, "backgroundColor"),
            Align = align,
            Padding = GetDouble(obj, "padding"),
            PaddingTop = GetDouble(obj, "paddingTop"),
            PaddingBottom = GetDouble(obj, "paddingBottom"),
            PaddingLeft = GetDouble(obj, "paddingLeft"),
            PaddingRight = GetDouble(obj, "paddingRight"),
            BorderTop = GetDouble(obj, "borderTop"),
            BorderBottom = GetDouble(obj, "borderBottom"),
            BorderLeft = GetDouble(obj, "borderLeft"),
            BorderRight = GetDouble(obj, "borderRight"),
            BorderColor = GetString(obj, "borderColor"),
        };
    }

    private static LocalizedText? ParseLocalizedText(JsonNode? node, string where, List<string> errors)
    {
        switch (node)
        {
            case null:
                return null;
            case JsonValue value when value.TryGetValue<string>(out var s):
                return new LocalizedText(s);
            case JsonObject map:
                {
                    var entries = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                    foreach (var (locale, localeNode) in map)
                    {
                        if (localeNode is JsonValue lv && lv.TryGetValue<string>(out var text))
                        {
                            entries[locale] = text;
                        }
                        else
                        {
                            errors.Add($"{where}.{locale} must be a string.");
                        }
                    }

                    if (entries.Count == 0)
                    {
                        errors.Add($"{where}: locale map must contain at least one entry.");
                        return LocalizedText.Empty;
                    }

                    return new LocalizedText(entries);
                }
            default:
                errors.Add($"{where} must be a string or a locale map object.");
                return null;
        }
    }

    private static string? GetString(JsonObject obj, string name) =>
        obj[name] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    private static bool? GetBool(JsonObject obj, string name) =>
        obj[name] is JsonValue v && v.TryGetValue<bool>(out var b) ? b : null;

    private static int? GetInt(JsonObject obj, string name) =>
        obj[name] is JsonValue v && v.TryGetValue<int>(out var i) ? i : null;

    private static double? GetDouble(JsonObject obj, string name) =>
        obj[name] is JsonValue v && v.TryGetValue<double>(out var d) ? d : null;
}
