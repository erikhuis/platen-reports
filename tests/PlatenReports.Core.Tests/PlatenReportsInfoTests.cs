using FluentAssertions;
using Xunit;

namespace PlatenReports.Tests;

public class PlatenReportsInfoTests
{
    [Fact]
    public void SupportedSchemaVersions_includes_the_current_version()
    {
        PlatenReportsInfo.SupportedSchemaVersions.Should().Contain(1);
    }

    [Fact]
    public void SupportedSchemaVersions_is_never_empty()
    {
        // An engine that supports nothing can load nothing; this guards against
        // a future refactor emptying the set.
        PlatenReportsInfo.SupportedSchemaVersions.Should().NotBeEmpty();
    }

    [Theory]
    [InlineData(1, true)]
    [InlineData(0, false)]
    [InlineData(2, false)]
    [InlineData(-1, false)]
    public void SupportsSchemaVersion_answers_by_set_membership(int version, bool expected)
    {
        PlatenReportsInfo.SupportsSchemaVersion(version).Should().Be(expected);
    }
}
