using System.Runtime.CompilerServices;
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
    /// <summary>Locates the real .csproj rather than a copy, so the assertion cannot drift from what ships.</summary>
    private static XDocument LoadProjectFile([CallerFilePath] string thisFile = "")
    {
        var testDirectory = Directory.GetParent(thisFile)!;
        var repositoryRoot = testDirectory.Parent!.Parent!;
        var csproj = Path.Combine(
            repositoryRoot.FullName, "src", "PlatenReports.Abstractions", "PlatenReports.Abstractions.csproj");

        File.Exists(csproj).Should().BeTrue($"the project file should be at {csproj}");
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
