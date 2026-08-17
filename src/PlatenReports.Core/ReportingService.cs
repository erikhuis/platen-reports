using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging;
using PlatenReports.Model;

namespace PlatenReports;

public sealed class ReportingService : IReportingService
{
    private readonly IReportDefinitionSource _definitions;
    private readonly IReportOverlayStore _overlays;
    private readonly IReportDataProviderRegistry _providers;
    private readonly IReportRenderer _renderer;
    private readonly IReportConditionEvaluator _conditions;
    private readonly IReportAssetProvider _assets;
    private readonly ILogger<ReportingService> _logger;
    private readonly ReportingOptions _options;
    private readonly TimeProvider _clock;

    /// <summary>Creates the orchestrator.</summary>
    /// <param name="definitions">Where published report definitions come from.</param>
    /// <param name="overlays">Where customisation overlays are stored.</param>
    /// <param name="providers">Resolves a definition's <c>dataSource</c> to a data provider.</param>
    /// <param name="renderer">Turns a parsed document plus its data into bytes.</param>
    /// <param name="conditions">Evaluates <c>visibleIf</c> expressions.</param>
    /// <param name="assets">Resolves the images a definition references.</param>
    /// <param name="logger">Diagnostics for merge warnings and render failures.</param>
    /// <param name="options">
    /// Null uses <see cref="ReportingOptions.Default"/>.
    /// </param>
    /// <param name="clock">
    /// Null uses <see cref="TimeProvider.System"/>. Injectable so the print timestamp is
    /// testable through <see cref="RenderAsync"/> rather than only through an internal helper.
    /// </param>
    public ReportingService(
        IReportDefinitionSource definitions,
        IReportOverlayStore overlays,
        IReportDataProviderRegistry providers,
        IReportRenderer renderer,
        IReportConditionEvaluator conditions,
        IReportAssetProvider assets,
        ILogger<ReportingService> logger,
        ReportingOptions? options = null,
        TimeProvider? clock = null)
    {
        _definitions = definitions;
        _overlays = overlays;
        _providers = providers;
        _renderer = renderer;
        _conditions = conditions;
        _assets = assets;
        _logger = logger;
        _options = options ?? ReportingOptions.Default;
        _clock = clock ?? TimeProvider.System;
    }

    public async Task<IReadOnlyList<ReportCatalogueItemDto>> ListAsync(string? locale = null, CancellationToken ct = default)
    {
        var effectiveLocale = string.IsNullOrWhiteSpace(locale) ? _options.DefaultLocale : locale;
        var overlayRows = (await _overlays.GetAllAsync(ct))
            .ToDictionary(o => o.ReportKey, StringComparer.OrdinalIgnoreCase);

        return _definitions.ListReports()
            .OrderBy(r => r.Key, StringComparer.Ordinal)
            .Select(report =>
            {
                var model = ReportDefinitionParser.Parse(report.CloneDocument());
                overlayRows.TryGetValue(report.Key, out var overlay);
                return new ReportCatalogueItemDto(
                    report.Key,
                    model.Title.Resolve(effectiveLocale),
                    report.Version,
                    report.DataSource,
                    report.RequiredPermission,
                    HasOverlay: overlay is not null,
                    OverlayEnabled: overlay?.IsEnabled ?? false,
                    model.Parameters.Select(p => new ReportParameterDto(p.Name, p.Type, p.Required)).ToList());
            })
            .ToList();
    }

    public async Task<EffectiveDefinitionDto?> GetEffectiveDefinitionAsync(string reportKey, CancellationToken ct = default)
    {
        var report = _definitions.Get(reportKey);
        if (report is null)
        {
            return null;
        }

        var overlay = await GetActiveOverlayDocumentAsync(reportKey, ct);
        var merge = ReportOverlayMerger.Merge(report.Document, overlay);
        return new EffectiveDefinitionDto(
            merge.Merged.ToJsonString(SerializerOptions),
            report.Version,
            merge.Warnings);
    }

    public string? GetStandardDefinitionJson(string reportKey) =>
        _definitions.Get(reportKey)?.Document.ToJsonString(SerializerOptions);

    public string? GetRequiredPermission(string reportKey) =>
        _definitions.Get(reportKey)?.RequiredPermission;

    public ReportFieldNode? GetFields(string reportKey)
    {
        var report = _definitions.Get(reportKey);
        if (report is null)
        {
            return null;
        }

        return _providers.Get(report.DataSource)?.DescribeFields();
    }

    public async Task<ReportOverlayDto?> GetOverlayAsync(string reportKey, CancellationToken ct = default)
    {
        var overlay = await _overlays.GetAsync(reportKey, ct);
        return overlay is null
            ? null
            : new ReportOverlayDto(overlay.ReportKey, overlay.OverlayJson, overlay.BaseVersion, overlay.IsEnabled, overlay.UpdatedAt);
    }

    public async Task<OverlayValidationResultDto> PutOverlayAsync(
        string reportKey, string overlayJson, bool isEnabled, CancellationToken ct = default)
    {
        var report = _definitions.Get(reportKey)
            ?? throw new KeyNotFoundException($"Unknown report '{reportKey}'.");

        var (overlayDocument, result) = ValidateOverlayCore(report, overlayJson);
        if (!result.Valid)
        {
            throw new ReportValidationException(result.Errors);
        }

        // Persisting re-stamps baseVersion to the version the admin just authored against.
        overlayDocument!["baseVersion"] = report.Version;
        overlayDocument["reportKey"] = report.Key;
        var normalizedJson = overlayDocument.ToJsonString(SerializerOptions);

        // Race-safe upsert: a plain read-then-insert lets two concurrent first-saves both see
        // "no row" and both insert. The store is required to converge on a collision rather
        // than surfacing it — see IReportOverlayStore.UpsertAsync.
        await _overlays.UpsertAsync(reportKey, normalizedJson, report.Version, isEnabled, ct);

        // BaseVersionOutdated is stale after the re-stamp; drop it from the response.
        return result with
        {
            Warnings = result.Warnings.Where(w => w.Code != OverlayMergeWarningCode.BaseVersionOutdated).ToList(),
        };
    }

    public Task<bool> DeleteOverlayAsync(string reportKey, CancellationToken ct = default) =>
        // The store answers "was there a row?" from the delete itself — no read first.
        _overlays.DeleteAsync(reportKey, ct);

    public Task<OverlayValidationResultDto> ValidateOverlayAsync(
        string reportKey, string overlayJson, CancellationToken ct = default)
    {
        var report = _definitions.Get(reportKey)
            ?? throw new KeyNotFoundException($"Unknown report '{reportKey}'.");
        var (_, result) = ValidateOverlayCore(report, overlayJson);
        return Task.FromResult(result);
    }

    public async Task<ReportRenderResult> RenderAsync(
        string reportKey,
        IReadOnlyDictionary<string, string> parameters,
        string locale,
        string? draftOverlayJson = null,
        string? timeZone = null,
        string? draftDefinitionJson = null,
        CancellationToken ct = default)
    {
        var report = _definitions.Get(reportKey)
            ?? throw new KeyNotFoundException($"Unknown report '{reportKey}'.");

        ReportDocumentModel model;
        string dataSource;
        IReadOnlyList<OverlayMergeWarning> mergeWarnings = [];
        if (draftDefinitionJson is not null)
        {
            // Preview a DRAFT definition (structural authoring). The
            // draft replaces the whole document; the stored overlay is ignored. Fatal parse
            // errors surface as the validation contract (400), never a 500 and never a silent
            // fallback to the shipped standard — the author must see their own errors.
            model = ReportDefinitionParser.Parse(ParseDraftDefinition(draftDefinitionJson));

            // SECURITY: the caller was authorized against the STORED report's requiredPermission
            // (keyed on reportKey). A draft may declare any dataSource, so previewing a draft whose
            // dataSource differs from the stored report would render a provider the caller was never
            // permission-checked for. Pin the provider to the
            // stored report's dataSource; authors may still change dataSource in the exported file, but
            // it cannot be previewed against another provider's live data through this report's grant.
            if (!string.Equals(model.DataSource, report.DataSource, StringComparison.Ordinal))
            {
                throw new ReportValidationException(
                    [$"Preview requires the draft's data source to match the report's ('{report.DataSource}')."]);
            }
            dataSource = report.DataSource;
        }
        else
        {
            JsonObject? overlay;
            if (draftOverlayJson is not null)
            {
                var (draftDocument, validation) = ValidateOverlayCore(report, draftOverlayJson);
                if (!validation.Valid)
                {
                    throw new ReportValidationException(validation.Errors);
                }

                overlay = draftDocument;
            }
            else
            {
                overlay = await GetActiveOverlayDocumentAsync(reportKey, ct);
            }

            var merge = ReportOverlayMerger.Merge(report.Document, overlay);
            mergeWarnings = merge.Warnings;
            foreach (var warning in merge.Warnings)
            {
                _logger.LogWarning(
                    "Report {ReportKey}: overlay patch skipped ({Code}, patch {PatchId}, target {TargetId}): {Message}",
                    reportKey, warning.Code, warning.PatchId, warning.TargetId, warning.Message);
            }

            try
            {
                model = ReportDefinitionParser.Parse(merge.Merged);
            }
            catch (ReportValidationException ex)
            {
                // The merger vets patches, so this signals a bug or definition drift. A customer's
                // stored overlay must never make a report unprintable — fall back to the standard.
                _logger.LogError(ex,
                    "Report {ReportKey}: merged definition failed validation; rendering the standard definition instead.",
                    reportKey);
                model = ReportDefinitionParser.Parse(report.CloneDocument());
            }

            dataSource = report.DataSource;
        }

        var provider = _providers.Get(dataSource)
            ?? throw new KeyNotFoundException($"Report '{reportKey}' references unknown data source '{dataSource}'.");

        var data = await provider.LoadAsync(new ReportParameters(parameters), ct);
        var effectiveLocale = string.IsNullOrWhiteSpace(locale) ? _options.DefaultLocale : locale;
        var zone = ResolveTimeZone(timeZone);
        var nowUtc = _clock.GetUtcNow().UtcDateTime;
        var dataWithMeta = InjectMeta(data, model, effectiveLocale, zone, nowUtc);

        var assets = await ResolveAssetsAsync(model, ct);
        var bytes = _renderer.Render(model, new ReportRenderContext(dataWithMeta, effectiveLocale, zone, assets));
        var fileName = BuildFileName(reportKey, zone, nowUtc, _renderer.FileExtension);
        return new ReportRenderResult(bytes, fileName, _renderer.ContentType, mergeWarnings);
    }

    /// <summary>
    /// Resolves every image source the document references, each at most once.
    /// </summary>
    /// <remarks>
    /// Done here rather than inside the renderer for two reasons: the renderer's tree walk is
    /// synchronous while <see cref="IReportAssetProvider.GetAsync"/> is not, and resolving up
    /// front means a logo referenced by both the page header and the page footer costs one fetch
    /// instead of two. Sources are de-duplicated case-insensitively, matching the lookup the
    /// renderer does.
    /// </remarks>
    private async Task<IReadOnlyDictionary<string, ReportAsset>> ResolveAssetsAsync(
        ReportDocumentModel model, CancellationToken ct)
    {
        var sources = ReportElementTree.Descendants(model)
            .OfType<ImageElement>()
            .Select(image => image.Source)
            .Where(source => !string.IsNullOrWhiteSpace(source))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var assets = new Dictionary<string, ReportAsset>(StringComparer.OrdinalIgnoreCase);
        foreach (var source in sources)
        {
            // A provider that cannot serve a source returns null; the element then draws
            // nothing — an unresolved asset is not an error.
            var asset = await _assets.GetAsync(source, ct);
            if (asset is { Content.Length: > 0 })
            {
                assets[source] = asset;
            }
        }

        return assets;
    }

    /// <summary>Parse a draft standard-definition JSON string into an object, surfacing bad JSON
    /// as the validation contract (never a raw JsonException / 500).</summary>
    private static JsonObject ParseDraftDefinition(string draftDefinitionJson)
    {
        try
        {
            return JsonNode.Parse(draftDefinitionJson) as JsonObject
                ?? throw new ReportValidationException(["Definition must be a JSON object."]);
        }
        catch (JsonException)
        {
            throw new ReportValidationException(["Definition is not valid JSON."]);
        }
    }

    private async Task<JsonObject?> GetActiveOverlayDocumentAsync(string reportKey, CancellationToken ct)
    {
        var overlay = await _overlays.GetAsync(reportKey, ct);
        if (overlay is null || !overlay.IsEnabled)
        {
            return null;
        }

        try
        {
            return JsonNode.Parse(overlay.OverlayJson) as JsonObject;
        }
        catch (JsonException ex)
        {
            // Stored overlays are validated on PUT; a corrupt row must not block printing.
            _logger.LogError(ex, "Report {ReportKey}: stored overlay is not valid JSON; ignoring it.", reportKey);
            return null;
        }
    }

    /// <summary>Structural + template + condition validation and a merge dry-run for one overlay.</summary>
    private (JsonObject? Document, OverlayValidationResultDto Result) ValidateOverlayCore(
        ReportDefinition report, string overlayJson)
    {
        JsonObject overlayDocument;
        try
        {
            if (JsonNode.Parse(overlayJson) is not JsonObject parsed)
            {
                return (null, new OverlayValidationResultDto(false, ["Overlay must be a JSON object."], []));
            }

            overlayDocument = parsed;
        }
        catch (JsonException ex)
        {
            return (null, new OverlayValidationResultDto(false, [$"Overlay is not valid JSON: {ex.Message}"], []));
        }

        var errors = new List<string>(ReportOverlayMerger.ValidateOverlayShape(overlayDocument));
        errors.AddRange(ValidateOverlayTemplates(overlayDocument));
        errors.AddRange(ValidateOverlayConditions(overlayDocument, report));
        if (errors.Count > 0)
        {
            return (overlayDocument, new OverlayValidationResultDto(false, errors, []));
        }

        // Dry-run the merge and re-parse so structural breakage shows up as errors at
        // authoring time (at render time the same condition falls back to the standard).
        var merge = ReportOverlayMerger.Merge(report.Document, overlayDocument);
        try
        {
            ReportDefinitionParser.Parse(merge.Merged);
        }
        catch (ReportValidationException ex)
        {
            return (overlayDocument, new OverlayValidationResultDto(false, ex.Errors, merge.Warnings));
        }

        return (overlayDocument, new OverlayValidationResultDto(true, [], merge.Warnings));
    }

    /// <summary>Scriban parse-check for every template-bearing string an overlay introduces.</summary>
    private static IEnumerable<string> ValidateOverlayTemplates(JsonObject overlay)
    {
        var errors = new List<string>();

        void CheckNode(JsonNode? node, string where)
        {
            switch (node)
            {
                case JsonValue value when value.TryGetValue<string>(out var s):
                    foreach (var error in ReportTextRenderer.ValidateTemplate(s))
                    {
                        errors.Add($"{where}: template error — {error}");
                    }

                    break;
                case JsonObject obj:
                    foreach (var (key, child) in obj)
                    {
                        CheckNode(child, $"{where}.{key}");
                    }

                    break;
                case JsonArray array:
                    for (var i = 0; i < array.Count; i++)
                    {
                        CheckNode(array[i], $"{where}[{i}]");
                    }

                    break;
            }
        }

        CheckNode(overlay["insert"], "insert");
        CheckNode(overlay["setProps"], "setProps");
        return errors;
    }

    /// <summary>
    /// Syntax + field-existence check for every <c>visibleIf</c> an overlay introduces.
    /// </summary>
    /// <remarks>
    /// Before this, nothing validated <c>visibleIf</c> at authoring time: a typo'd path parsed
    /// fine, then failed at render as an unknown identifier and silently hid the element on every
    /// print. Catching it here turns a blank report into a designer validation error.
    ///
    /// Field checking needs the provider's tree. If the report's data source has no registered
    /// provider we still check syntax and the function allowlist, rather than skipping the whole
    /// check — a definition can outlive its provider registration, and half a check beats none.
    /// </remarks>
    private IEnumerable<string> ValidateOverlayConditions(JsonObject overlay, ReportDefinition report)
    {
        var errors = new List<string>();
        var fields = _providers.Get(report.DataSource)?.DescribeFields();
        var knownPaths = fields is null ? null : ReportFieldNode.ConditionPaths(fields);

        void CheckNode(JsonNode? node, string where)
        {
            switch (node)
            {
                case JsonObject obj:
                    foreach (var (key, child) in obj)
                    {
                        if (key == "visibleIf" && child is JsonValue v && v.TryGetValue<string>(out var expression))
                        {
                            foreach (var error in _conditions.Validate(expression, knownPaths))
                            {
                                errors.Add($"{where}.visibleIf: {error}");
                            }
                        }
                        else
                        {
                            CheckNode(child, $"{where}.{key}");
                        }
                    }
                    break;
                case JsonArray array:
                    for (var i = 0; i < array.Count; i++)
                    {
                        CheckNode(array[i], $"{where}[{i}]");
                    }

                    break;
            }
        }

        CheckNode(overlay["insert"], "insert");
        CheckNode(overlay["setProps"], "setProps");
        return errors;
    }

    private static ReportDataContext InjectMeta(
        ReportDataContext data, ReportDocumentModel model, string locale, TimeZoneInfo zone, DateTime nowUtc)
    {
        // The print timestamp is rendered in the caller's time zone (the browser passes its
        // IANA id) — a UTC-only stamp is ambiguous on paper. Unknown/missing ids fall back to
        // UTC and say so, rather than silently pretending a zone.
        var nowLocal = TimeZoneInfo.ConvertTimeFromUtc(nowUtc, zone);
        var culture = ReportCulture.Resolve(locale);

        var root = new Dictionary<string, object?>(data.Root)
        {
            ["meta"] = new Dictionary<string, object?>
            {
                ["generatedAt"] = nowUtc,
                ["generatedAtLocal"] = nowLocal.ToString("g", culture),
                ["timeZone"] = zone.Id,
                ["locale"] = locale,
                ["reportTitle"] = model.Title.Resolve(locale),
                // Always empty: the engine has no branding store. Kept so the path stays
                // bindable — see platen-reports#7 for removing it.
                ["tenantName"] = string.Empty,
            },
        };
        return new ReportDataContext(root);
    }

    internal static TimeZoneInfo ResolveTimeZone(string? timeZone)
    {
        if (string.IsNullOrWhiteSpace(timeZone))
        {
            return TimeZoneInfo.Utc;
        }

        try
        {
            // .NET resolves both IANA ("Europe/Amsterdam") and Windows ids cross-platform.
            return TimeZoneInfo.FindSystemTimeZoneById(timeZone.Trim());
        }
        catch (Exception e) when (e is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            return TimeZoneInfo.Utc;
        }
    }

    /// <summary>
    /// Export filename is always "{reportKey}-{datetime, with seconds}.{ext}" in the
    /// caller's time zone, so repeated exports (e.g. re-printing the same work order) never
    /// collide in a downloads folder.
    /// </summary>
    /// <param name="reportKey">The report key, used as the filename stem.</param>
    /// <param name="zone">Time zone the timestamp is rendered in.</param>
    /// <param name="nowUtc">The render instant, in UTC.</param>
    /// <param name="extension">
    /// From <see cref="IReportRenderer.FileExtension"/>, without a leading dot — the orchestrator
    /// does not assume PDF.
    /// </param>
    /// <returns>The suggested download filename.</returns>
    internal static string BuildFileName(string reportKey, TimeZoneInfo zone, DateTime nowUtc, string extension)
    {
        var timestamp = TimeZoneInfo.ConvertTimeFromUtc(nowUtc, zone);
        return $"{reportKey}-{timestamp:yyyy-MM-dd_HH-mm-ss}.{extension.TrimStart('.')}";
    }

    private static readonly JsonSerializerOptions SerializerOptions = new() { WriteIndented = true };
}
