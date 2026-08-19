using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using PlatenReports.Model;
using Xunit;

namespace PlatenReports.AspNetCore.Tests;

/// <summary>The one-line host wiring, and what it deliberately does not do.</summary>
public class ServiceCollectionExtensionsTests
{
    /// <summary>Registers the ports the engine cannot invent, so resolution is the thing under test.</summary>
    private static ServiceCollection WithHostPorts()
    {
        var services = new ServiceCollection();
        services.AddLogging(b => b.AddProvider(NullLoggerProvider.Instance));
        services.AddSingleton<IReportDefinitionSource, StubDefinitions>();
        services.AddSingleton<IReportOverlayStore, StubOverlays>();
        services.AddSingleton<IReportDataProviderRegistry, StubProviders>();
        services.AddSingleton<IReportRenderer, StubRenderer>();
        services.AddSingleton<IReportConditionEvaluator, StubConditions>();
        services.AddSingleton<IReportAssetProvider, StubAssets>();
        return services;
    }

    [Fact]
    public void AddPlatenReports_yields_a_resolvable_reporting_service()
    {
        var provider = WithHostPorts().AddPlatenReports().BuildServiceProvider();

        provider.CreateScope().ServiceProvider.GetRequiredService<IReportingService>()
            .Should().BeOfType<ReportingService>();
    }

    [Fact]
    public void The_container_honours_the_engine_s_optional_constructor_parameters()
    {
        // Worth pinning because it reads the other way round. ReportingService declares
        // ReportingOptions and TimeProvider as optional parameters, and the built-in container
        // does construct it without either registered — so the registration in AddPlatenReports
        // exists to make a *supplied* options instance take effect, not to make resolution work.
        // An earlier version of that comment claimed the opposite; this test is what caught it.
        var services = WithHostPorts();
        services.AddScoped<IReportingService, ReportingService>();   // no options, no clock

        var act = () => services.BuildServiceProvider()
            .CreateScope().ServiceProvider.GetRequiredService<IReportingService>();

        act.Should().NotThrow();
    }

    [Fact]
    public void AddPlatenReports_leaves_the_TimeProvider_slot_alone()
    {
        // The engine already falls back to TimeProvider.System, so claiming this registration
        // would buy nothing and take a slot a host may want for a fake clock.
        var provider = WithHostPorts().AddPlatenReports().BuildServiceProvider();

        provider.GetService<TimeProvider>().Should().BeNull();
    }

    [Fact]
    public void AddPlatenReports_honours_a_supplied_options_instance()
    {
        // ReportingOptions is init-only, which is why this takes an instance rather than the
        // usual Action<T> — a callback would have nothing it could set.
        var options = new ReportingOptions { DefaultLocale = "nl" };

        var provider = WithHostPorts().AddPlatenReports(options).BuildServiceProvider();

        provider.GetRequiredService<ReportingOptions>().DefaultLocale.Should().Be("nl");
    }

    [Fact]
    public void AddPlatenReports_registers_no_authorizer()
    {
        // No safe default exists, so the endpoints fail closed at resolution instead.
        var provider = WithHostPorts().AddPlatenReports().BuildServiceProvider();

        provider.GetService<IReportAuthorizer>().Should().BeNull();
    }

    [Fact]
    public void AddAllowAllReportAuthorizer_is_opt_in_and_registers_the_startup_warning()
    {
        var services = WithHostPorts().AddPlatenReports().AddAllowAllReportAuthorizer();
        var provider = services.BuildServiceProvider();

        provider.GetRequiredService<IReportAuthorizer>().Should().BeOfType<AllowAllReportAuthorizer>();
        provider.GetServices<IHostedService>().Should().ContainSingle();
    }

    [Fact]
    public async Task The_allow_all_warning_actually_fires_at_startup()
    {
        // A warning nobody emits is not a warning. Asserted through a real logger.
        var recorder = new RecordingLoggerProvider();
        var services = WithHostPorts();
        services.AddLogging(b => b.AddProvider(recorder));
        var provider = services.AddPlatenReports().AddAllowAllReportAuthorizer().BuildServiceProvider();

        foreach (var hosted in provider.GetServices<IHostedService>())
        {
            await hosted.StartAsync(CancellationToken.None);
        }

        recorder.Warnings.Should().ContainSingle()
            .Which.Should().Contain("AllowAllReportAuthorizer").And.Contain("open to");
    }

    [Fact]
    public void A_host_registration_beats_the_allow_all_one()
    {
        // TryAdd, so wiring order cannot silently downgrade a real authorizer to allow-all.
        var services = WithHostPorts();
        services.AddSingleton<IReportAuthorizer, DenyingAuthorizer>();

        services.AddAllowAllReportAuthorizer();

        services.BuildServiceProvider().GetRequiredService<IReportAuthorizer>()
            .Should().BeOfType<DenyingAuthorizer>();
    }

    [Fact]
    public void Both_extensions_reject_a_null_collection()
    {
        var add = () => ((IServiceCollection)null!).AddPlatenReports();
        var allow = () => ((IServiceCollection)null!).AddAllowAllReportAuthorizer();

        add.Should().Throw<ArgumentNullException>();
        allow.Should().Throw<ArgumentNullException>();
    }

    // ── Stubs ────────────────────────────────────────────────────────────────

    private sealed class DenyingAuthorizer : IReportAuthorizer
    {
        public ValueTask<bool> CanViewCatalogueAsync(CancellationToken ct = default) => ValueTask.FromResult(false);
        public ValueTask<bool> CanManageDefinitionsAsync(CancellationToken ct = default) => ValueTask.FromResult(false);
        public ValueTask<bool> CanRenderAsync(string k, string? p, CancellationToken ct = default) => ValueTask.FromResult(false);
    }

    private sealed class StubDefinitions : IReportDefinitionSource
    {
        public IReadOnlyList<ReportDefinition> ListReports() => [];
        public ReportDefinition? Get(string key) => null;
    }

    private sealed class StubOverlays : IReportOverlayStore
    {
        public Task<ReportOverlayRecord?> GetAsync(string reportKey, CancellationToken ct = default) =>
            Task.FromResult<ReportOverlayRecord?>(null);
        public Task<IReadOnlyList<ReportOverlayRecord>> GetAllAsync(CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<ReportOverlayRecord>>([]);
        public Task<ReportOverlayRecord> UpsertAsync(
            string reportKey, string overlayJson, string? baseVersion, bool isEnabled, CancellationToken ct = default) =>
            Task.FromResult(new ReportOverlayRecord(reportKey, overlayJson, baseVersion, isEnabled, DateTime.UnixEpoch));
        public Task<bool> DeleteAsync(string reportKey, CancellationToken ct = default) => Task.FromResult(false);
    }

    private sealed class StubProviders : IReportDataProviderRegistry
    {
        public IReportDataProvider? Get(string key) => null;
        public IReadOnlyList<IReportDataProvider> All() => [];
    }

    private sealed class StubRenderer : IReportRenderer
    {
        public string ContentType => "application/pdf";
        public string FileExtension => "pdf";
        public byte[] Render(ReportDocumentModel document, ReportRenderContext context) => [];
    }

    private sealed class StubConditions : IReportConditionEvaluator
    {
        public ConditionResult Evaluate(string expression, IReadOnlyDictionary<string, object?> scope) =>
            ConditionResult.Shown;
        public IReadOnlyList<string> Validate(string expression, IReadOnlySet<string>? knownPaths = null) => [];
    }

    private sealed class StubAssets : IReportAssetProvider
    {
        public ValueTask<ReportAsset?> GetAsync(string source, CancellationToken ct = default) =>
            ValueTask.FromResult<ReportAsset?>(null);
    }

    private sealed class RecordingLoggerProvider : ILoggerProvider
    {
        internal List<string> Warnings { get; } = [];
        public ILogger CreateLogger(string categoryName) => new Recorder(Warnings);
        public void Dispose() { }

        private sealed class Recorder(List<string> warnings) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
            public bool IsEnabled(LogLevel logLevel) => true;
            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
                Func<TState, Exception?, string> formatter)
            {
                if (logLevel == LogLevel.Warning)
                {
                    warnings.Add(formatter(state, exception));
                }
            }
        }
    }
}
