using System.Xml.Linq;
using FluentAssertions;
using PlatenReports.Model;
using Xunit;

namespace PlatenReports.Abstractions.Tests;

/// <summary>
/// The one property this package exists to have. Hosts implement <c>IReportDataProvider</c>
/// against it, so a dependency here is a dependency every host inherits — and "the contract
/// layer is licence-clean" stops being checkable the moment there is something to audit.
/// </summary>
public class DependencyFreedomTests
{
    /// <summary>
    /// Reads the project file that was just compiled. The build copies it next to the test
    /// assembly, so the assertion cannot drift from what ships — and, unlike locating it from
    /// <c>[CallerFilePath]</c>, this survives a CI build, which path-maps source paths to
    /// <c>/_/…</c> for determinism and would leave the file nowhere to be found.
    /// </summary>
    private static XDocument LoadProjectFile()
    {
        var csproj = Path.Combine(AppContext.BaseDirectory, "PlatenReports.Abstractions.csproj");

        File.Exists(csproj).Should().BeTrue(
            $"the build should copy the project file to {csproj} — see the None/CopyToOutputDirectory item in the test .csproj");
        return XDocument.Load(csproj);
    }

    [Fact]
    public void The_project_declares_no_package_reference()
    {
        var packages = LoadProjectFile()
            .Descendants("PackageReference")
            .Select(e => e.Attribute("Include")?.Value)
            .ToList();

        packages.Should().BeEmpty(
            "PlatenReports.Abstractions must stay dependency-free — a type that needs a package belongs in PlatenReports.Core");
    }

    [Fact]
    public void The_project_declares_no_project_reference()
    {
        // A ProjectReference would reintroduce dependencies transitively, defeating the check above.
        LoadProjectFile().Descendants("ProjectReference").Should().BeEmpty();
    }

    [Fact]
    public void The_built_assembly_references_only_the_framework()
    {
        // The csproj states intent; this checks what actually shipped. Anything outside the
        // BCL here means a dependency arrived by a route the file-level check cannot see.
        var referenced = typeof(ReportElement).Assembly
            .GetReferencedAssemblies()
            .Select(a => a.Name!)
            .Where(name => !name.StartsWith("System", StringComparison.Ordinal)
                        && !name.Equals("netstandard", StringComparison.Ordinal))
            .ToList();

        referenced.Should().BeEmpty();
    }
}
