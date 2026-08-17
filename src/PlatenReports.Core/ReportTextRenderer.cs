using System.Collections.Concurrent;
using System.Globalization;
using Scriban;
using Scriban.Runtime;

namespace PlatenReports;

/// <summary>
/// Renders report text templates (Scriban) against the current data scope.
///
/// Overlay templates are authored by customer administrators and rendered unattended, so the
/// loop and recursion limits are pinned here as a security posture, not a performance dial
/// (see GHSA-24c8-4792-22hx). A template error degrades to a visible per-element placeholder —
/// one broken template must never take the whole report down.
/// </summary>
public static class ReportTextRenderer
{
    public const string ErrorPlaceholder = "⚠ template error";

    private static readonly ConcurrentDictionary<string, Template?> TemplateCache = new();

    /// <summary>Renders one template against a scope.</summary>
    /// <remarks>Fast path: text without Scriban markers is returned as-is, which is most labels.</remarks>
    /// <param name="template">The template text. Returned unchanged when it holds no <c>{{</c> marker.</param>
    /// <param name="scope">The current data scope — a table row item inside a table, else the document root.</param>
    /// <param name="root">
    /// The document root, so a cell template can reach header-level values that are not on the
    /// row item. Null when the scope already is the root.
    /// </param>
    /// <param name="culture">Report culture for number/date rendering inside templates; null keeps Scriban's invariant default.</param>
    /// <param name="options">
    /// Sandbox limits. Null uses <see cref="ReportingOptions.Default"/>, which carries
    /// the values that were hardcoded here before — the posture is unchanged unless a host
    /// deliberately changes it.
    ///
    /// The loop and recursion limits are per-render and take effect immediately.
    /// <see cref="ReportingOptions.TemplateCacheLimit"/> is different: the parse cache is
    /// process-wide and static, so the limit only decides whether *this* call may add an entry.
    /// With two hosts in one process the tighter limit simply stops adding sooner. That is a
    /// bound on growth, not a per-host quota, and it is not worth making it one.
    /// </param>
    /// <returns>The rendered text, or a visible placeholder when the template failed.</returns>
    public static string Render(
        string template, IReadOnlyDictionary<string, object?> scope,
        IReadOnlyDictionary<string, object?>? root = null, CultureInfo? culture = null,
        ReportingOptions? options = null)
    {
        options ??= ReportingOptions.Default;

        if (string.IsNullOrEmpty(template) || !template.Contains("{{", StringComparison.Ordinal))
        {
            return template;
        }

        var parsed = GetTemplate(template, options.TemplateCacheLimit);
        if (parsed is null)
        {
            return ErrorPlaceholder;
        }

        try
        {
            var bindings = new ScriptObject();
            // Root first so row-scope keys win on collision — same precedence as the path binder.
            if (root is not null && !ReferenceEquals(root, scope))
            {
                foreach (var kvp in root)
                {
                    bindings[kvp.Key] = kvp.Value;
                }
            }

            foreach (var kvp in scope)
            {
                bindings[kvp.Key] = kvp.Value;
            }

            var context = new TemplateContext
            {
                MemberRenamer = member => member.Name,
                LoopLimit = options.ScribanLoopLimit,
                RecursiveLimit = options.ScribanRecursiveLimit,
            };
            if (culture is not null)
            {
                context.PushCulture(culture);
            }

            context.PushGlobal(bindings);
            return parsed.Render(context);
        }
        catch
        {
            return ErrorPlaceholder;
        }
    }

    /// <summary>Parse-only validation used by the overlay PUT/validate endpoints.</summary>
    public static IReadOnlyList<string> ValidateTemplate(string template)
    {
        if (string.IsNullOrEmpty(template) || !template.Contains("{{", StringComparison.Ordinal))
        {
            return [];
        }

        var parsed = Template.Parse(template);
        return parsed.HasErrors
            ? parsed.Messages.Select(m => m.Message).ToList()
            : [];
    }

    private static Template? GetTemplate(string template, int cacheLimit)
    {
        if (TemplateCache.TryGetValue(template, out var cached))
        {
            return cached;
        }

        // Simple bound: report definitions hold a small, stable set of templates per process.
        // If a pathological overlay churns unique templates, stop caching rather than grow.
        var parsed = Template.Parse(template);
        var result = parsed.HasErrors ? null : parsed;
        if (TemplateCache.Count < cacheLimit)
        {
            TemplateCache.TryAdd(template, result);
        }

        return result;
    }
}
