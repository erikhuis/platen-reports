using System.Text.Json.Nodes;
using FluentAssertions;
using PlatenReports.Model;
using Xunit;

namespace PlatenReports.Core.Tests;

/// <summary>
/// Reporting engine — merge semantics of tenant overlays over standard definitions.
/// The invariant under test: patches that cannot apply are skipped with a warning; the merge
/// itself never fails, so a shipped standard update can never make a tenant's report
/// unprintable.
/// </summary>
public class ReportOverlayMergerTests
{
    private static JsonObject StandardDefinition() => (JsonObject)JsonNode.Parse("""
    {
      "schemaVersion": 1,
      "key": "test-report",
      "version": "1.2.0",
      "title": "Test",
      "dataSource": "test",
      "pageHeader": { "id": "hdr", "type": "row", "children": [
        { "id": "hdr-title", "type": "text", "text": "Title" },
        { "id": "hdr-logo", "type": "image", "source": "tenantLogo" }
      ]},
      "body": [
        { "id": "summary", "type": "keyValueGrid", "pairs": [
          { "id": "kv-status", "label": "Status", "path": "item.status" },
          { "id": "kv-name", "label": "Name", "path": "item.name" }
        ]},
        { "id": "detail-text", "type": "text", "text": "Detail" },
        { "id": "lines", "type": "table", "bind": "item.lines", "columns": [
          { "id": "col-code", "header": "Code", "path": "code" },
          { "id": "col-qty", "header": "Qty", "path": "qty" }
        ]}
      ],
      "pageFooter": { "id": "ftr", "type": "pageNumber" }
    }
    """)!;

    private static JsonObject Overlay(string json) => (JsonObject)JsonNode.Parse(json)!;

    [Fact]
    public void Suppress_removes_element_and_subtree()
    {
        var result = ReportOverlayMerger.Merge(StandardDefinition(), Overlay("""
            { "suppress": ["hdr-logo", "detail-text"] }
            """));

        result.Warnings.Should().BeEmpty();
        result.Merged.ToJsonString().Should().NotContain("hdr-logo").And.NotContain("detail-text");
        // Untouched elements survive.
        result.Merged.ToJsonString().Should().Contain("hdr-title").And.Contain("summary");
    }

    [Fact]
    public void Suppress_unknown_id_warns_and_continues()
    {
        var result = ReportOverlayMerger.Merge(StandardDefinition(), Overlay("""
            { "suppress": ["does-not-exist", "detail-text"] }
            """));

        result.Warnings.Should().ContainSingle(w => w.Code == OverlayMergeWarningCode.SuppressedIdNotFound);
        result.Merged.ToJsonString().Should().NotContain("detail-text");
    }

    [Fact]
    public void Suppress_can_remove_a_table_column()
    {
        var result = ReportOverlayMerger.Merge(StandardDefinition(), Overlay("""
            { "suppress": ["col-qty"] }
            """));

        result.Warnings.Should().BeEmpty();
        var columns = result.Merged["body"]![2]!["columns"]!.AsArray();
        columns.Should().HaveCount(1);
        columns[0]!["id"]!.GetValue<string>().Should().Be("col-code");
    }

    [Fact]
    public void Suppress_of_the_last_remaining_table_column_is_blocked_with_warning()
    {
        // col-code removes fine (2 → 1); col-qty is then the last column and a table with zero
        // columns fails the parser — the merge must keep it and warn instead.
        var result = ReportOverlayMerger.Merge(StandardDefinition(), Overlay("""
            { "suppress": ["col-code", "col-qty"] }
            """));

        result.Warnings.Should().ContainSingle(w => w.Code == OverlayMergeWarningCode.SuppressBlocked)
            .Which.TargetId.Should().Be("col-qty");
        var columns = result.Merged["body"]![2]!["columns"]!.AsArray();
        columns.Should().ContainSingle().Which!["id"]!.GetValue<string>().Should().Be("col-qty");
        var act = () => ReportDefinitionParser.Parse(result.Merged);
        act.Should().NotThrow("the guard exists to keep the merged document parseable");
    }

    [Theory]
    [InlineData("totals")]
    [InlineData("groupTotals")]
    public void Suppress_of_a_column_referenced_by_totals_is_blocked_with_warning(string totalsProp)
    {
        var standard = StandardDefinition();
        var table = standard["body"]!.AsArray()[2]!.AsObject();
        if (totalsProp == "groupTotals")
        {
            table["groupBy"] = "code";
        }
        table[totalsProp] = JsonNode.Parse("""[ { "columnId": "col-qty", "aggregate": "sum" } ]""");

        var result = ReportOverlayMerger.Merge(standard, Overlay("""
            { "suppress": ["col-qty"] }
            """));

        result.Warnings.Should().ContainSingle(w => w.Code == OverlayMergeWarningCode.SuppressBlocked)
            .Which.TargetId.Should().Be("col-qty");
        result.Merged["body"]![2]!["columns"]!.AsArray().Should().HaveCount(2, "the referenced column survives");
    }

    [Fact]
    public void Suppress_of_the_last_remaining_keyValueGrid_pair_is_blocked_with_warning()
    {
        var result = ReportOverlayMerger.Merge(StandardDefinition(), Overlay("""
            { "suppress": ["kv-status", "kv-name"] }
            """));

        result.Warnings.Should().ContainSingle(w => w.Code == OverlayMergeWarningCode.SuppressBlocked)
            .Which.TargetId.Should().Be("kv-name");
        result.Merged["body"]![0]!["pairs"]!.AsArray()
            .Should().ContainSingle().Which!["id"]!.GetValue<string>().Should().Be("kv-name");
    }

    [Fact]
    public void ValidateOverlayShape_reports_unknown_top_level_keys()
    {
        // Typos ("supress", "inserts", "setprops") used to be silently ignored — the admin
        // saved a no-op overlay and saw nothing change. They must fail validation.
        var errors = ReportOverlayMerger.ValidateOverlayShape(Overlay("""
            { "supress": ["hdr-logo"], "inserts": [], "setprops": [] }
            """));

        errors.Should().HaveCount(3)
            .And.OnlyContain(e => e.Contains("Unknown top-level key"));
    }

    [Fact]
    public void ValidateOverlayShape_accepts_the_known_keys_and_stored_metadata()
    {
        // schemaVersion/reportKey come from the editor's default skeleton, baseVersion is
        // stamped onto the stored document by PutOverlayAsync — a fresh customization and a
        // stored overlay round-tripped through the editor must both stay valid (caught in
        // preview: the default skeleton was rejected over 'schemaVersion').
        var errors = ReportOverlayMerger.ValidateOverlayShape(Overlay("""
            { "schemaVersion": 1, "baseVersion": "1.2.0", "reportKey": "test-report",
              "suppress": [], "insert": [], "setProps": [] }
            """));

        errors.Should().BeEmpty();
    }

    [Theory]
    [InlineData("before", 1)]
    [InlineData("after", 2)]
    public void Insert_before_and_after_position_relative_to_anchor(string position, int expectedIndex)
    {
        var result = ReportOverlayMerger.Merge(StandardDefinition(), Overlay($$"""
            { "insert": [{ "id": "p1", "anchor": "detail-text", "position": "{{position}}",
                "element": { "id": "tenant-note", "type": "text", "text": "Note" } }] }
            """));

        result.Warnings.Should().BeEmpty();
        var body = result.Merged["body"]!.AsArray();
        body.Should().HaveCount(4);
        body[expectedIndex]!["id"]!.GetValue<string>().Should().Be("tenant-note");
    }

    [Fact]
    public void Insert_appendInto_adds_to_container_children()
    {
        var result = ReportOverlayMerger.Merge(StandardDefinition(), Overlay("""
            { "insert": [{ "id": "p1", "anchor": "hdr", "position": "appendInto",
                "element": { "id": "hdr-extra", "type": "text", "text": "Extra" } }] }
            """));

        result.Warnings.Should().BeEmpty();
        var children = result.Merged["pageHeader"]!["children"]!.AsArray();
        children[^1]!["id"]!.GetValue<string>().Should().Be("hdr-extra");
    }

    [Fact]
    public void Insert_into_body_pseudo_anchor_appends_section()
    {
        var result = ReportOverlayMerger.Merge(StandardDefinition(), Overlay("""
            { "insert": [{ "id": "p1", "anchor": "$body", "position": "appendInto",
                "element": { "id": "tenant-footer-note", "type": "text", "text": "Custom" } }] }
            """));

        result.Warnings.Should().BeEmpty();
        result.Merged["body"]!.AsArray()[^1]!["id"]!.GetValue<string>().Should().Be("tenant-footer-note");
    }

    [Fact]
    public void Insert_can_anchor_on_earlier_inserted_element()
    {
        var result = ReportOverlayMerger.Merge(StandardDefinition(), Overlay("""
            { "insert": [
                { "id": "p1", "anchor": "detail-text", "position": "after",
                  "element": { "id": "tenant-a", "type": "text", "text": "A" } },
                { "id": "p2", "anchor": "tenant-a", "position": "after",
                  "element": { "id": "tenant-b", "type": "text", "text": "B" } }
            ]}
            """));

        result.Warnings.Should().BeEmpty();
        var body = result.Merged["body"]!.AsArray();
        body[2]!["id"]!.GetValue<string>().Should().Be("tenant-a");
        body[3]!["id"]!.GetValue<string>().Should().Be("tenant-b");
    }

    [Fact]
    public void Insert_with_unresolvable_anchor_is_skipped_with_warning()
    {
        var result = ReportOverlayMerger.Merge(StandardDefinition(), Overlay("""
            { "insert": [{ "id": "p1", "anchor": "removed-by-new-standard-version", "position": "after",
                "element": { "id": "tenant-note", "type": "text", "text": "Note" } }] }
            """));

        result.Warnings.Should().ContainSingle(w => w.Code == OverlayMergeWarningCode.InsertAnchorNotFound);
        result.Merged.ToJsonString().Should().NotContain("tenant-note");
    }

    [Fact]
    public void Insert_with_colliding_id_is_skipped_with_warning()
    {
        var result = ReportOverlayMerger.Merge(StandardDefinition(), Overlay("""
            { "insert": [{ "id": "p1", "anchor": "detail-text", "position": "after",
                "element": { "id": "summary", "type": "text", "text": "Duplicate id" } }] }
            """));

        result.Warnings.Should().ContainSingle(w => w.Code == OverlayMergeWarningCode.InsertIdCollision);
        result.Merged["body"]!.AsArray().Should().HaveCount(3);
    }

    [Fact]
    public void Insert_with_invalid_element_payload_is_skipped_with_warning()
    {
        var result = ReportOverlayMerger.Merge(StandardDefinition(), Overlay("""
            { "insert": [{ "id": "p1", "anchor": "detail-text", "position": "after",
                "element": { "id": "bad", "type": "no-such-type" } }] }
            """));

        result.Warnings.Should().ContainSingle(w => w.Code == OverlayMergeWarningCode.InsertInvalidElement);
    }

    [Fact]
    public void Insert_appendInto_non_container_is_skipped_with_warning()
    {
        var result = ReportOverlayMerger.Merge(StandardDefinition(), Overlay("""
            { "insert": [{ "id": "p1", "anchor": "detail-text", "position": "appendInto",
                "element": { "id": "tenant-note", "type": "text", "text": "Note" } }] }
            """));

        result.Warnings.Should().ContainSingle(w => w.Code == OverlayMergeWarningCode.InsertInvalidTarget);
    }

    [Fact]
    public void Insert_appendInto_container_adds_to_its_children()
    {
        var standard = (JsonObject)JsonNode.Parse("""
        {
          "schemaVersion": 1, "key": "k", "version": "1.0.0", "title": "T", "dataSource": "d",
          "body": [
            { "id": "card", "type": "container", "title": "General", "children": [
              { "id": "inner", "type": "text", "text": "existing" }
            ] }
          ]
        }
        """)!;

        var result = ReportOverlayMerger.Merge(standard, Overlay("""
            { "insert": [{ "id": "p1", "anchor": "card", "position": "appendInto",
                "element": { "id": "tenant-extra", "type": "text", "text": "added" } }],
              "setProps": [{ "id": "card", "props": { "title": { "en": "Renamed" } } }] }
            """));

        result.Warnings.Should().BeEmpty();
        var card = result.Merged["body"]!.AsArray()[0]!;
        card["children"]!.AsArray()[^1]!["id"]!.GetValue<string>().Should().Be("tenant-extra");
        card["title"]!["en"]!.GetValue<string>().Should().Be("Renamed");
    }

    [Fact]
    public void SetProps_overrides_leaf_and_style_props()
    {
        var result = ReportOverlayMerger.Merge(StandardDefinition(), Overlay("""
            { "setProps": [{ "id": "hdr-title", "props": { "text": "WO print", "style.fontSize": 20 } }] }
            """));

        result.Warnings.Should().BeEmpty();
        var title = result.Merged["pageHeader"]!["children"]!.AsArray()[0]!;
        title["text"]!.GetValue<string>().Should().Be("WO print");
        title["style"]!["fontSize"]!.GetValue<double>().Should().Be(20);
    }

    [Fact]
    public void SetProps_toggles_markdown_on_a_keyValueGrid_pair()
    {
        // Issue #2168 — a tenant overlay must be able to toggle markdown rendering on/off
        // (the same allowlisted leaf applies to field elements and keyValueGrid pairs alike).
        var result = ReportOverlayMerger.Merge(StandardDefinition(), Overlay("""
            { "setProps": [{ "id": "kv-status", "props": { "markdown": true } }] }
            """));

        result.Warnings.Should().BeEmpty();
        var summary = result.Merged["body"]!.AsArray().OfType<JsonObject>().Single(e => e["id"]!.GetValue<string>() == "summary");
        var pair = summary["pairs"]!.AsArray().OfType<JsonObject>().Single(p => p["id"]!.GetValue<string>() == "kv-status");
        pair["markdown"]!.GetValue<bool>().Should().BeTrue();
    }

    [Fact]
    public void SetProps_applies_to_elements_inserted_by_the_same_overlay()
    {
        var result = ReportOverlayMerger.Merge(StandardDefinition(), Overlay("""
            {
              "insert": [{ "id": "p1", "anchor": "detail-text", "position": "after",
                "element": { "id": "tenant-note", "type": "text", "text": "Note" } }],
              "setProps": [{ "id": "tenant-note", "props": { "style.bold": true } }]
            }
            """));

        result.Warnings.Should().BeEmpty();
        var inserted = result.Merged["body"]!.AsArray()[2]!;
        inserted["style"]!["bold"]!.GetValue<bool>().Should().BeTrue();
    }

    [Fact]
    public void SetProps_repeatHeader_is_allowlisted_and_applies_to_a_table()
    {
        // Issue #2163 — repeatHeader is display-level like align/spacing (decided on
        // #2161): a tenant toggling it off must merge cleanly, no SetPropsDisallowedProp.
        var result = ReportOverlayMerger.Merge(StandardDefinition(), Overlay("""
            { "setProps": [{ "id": "lines", "props": { "repeatHeader": false } }] }
            """));

        result.Warnings.Should().BeEmpty();
        var table = result.Merged["body"]!.AsArray().First(n => n!["id"]!.GetValue<string>() == "lines")!;
        table["repeatHeader"]!.GetValue<bool>().Should().BeFalse();
    }

    [Fact]
    public void SetProps_disallowed_prop_is_skipped_with_warning_but_others_apply()
    {
        var result = ReportOverlayMerger.Merge(StandardDefinition(), Overlay("""
            { "setProps": [{ "id": "hdr-title", "props": { "id": "renamed", "type": "image", "text": "Kept" } }] }
            """));

        result.Warnings.Should().HaveCount(2)
            .And.OnlyContain(w => w.Code == OverlayMergeWarningCode.SetPropsDisallowedProp);
        var title = result.Merged["pageHeader"]!["children"]!.AsArray()[0]!;
        title["id"]!.GetValue<string>().Should().Be("hdr-title");
        title["type"]!.GetValue<string>().Should().Be("text");
        title["text"]!.GetValue<string>().Should().Be("Kept");
    }

    [Fact]
    public void BaseVersion_mismatch_yields_informational_warning()
    {
        var result = ReportOverlayMerger.Merge(StandardDefinition(), Overlay("""
            { "baseVersion": "1.0.0", "suppress": ["hdr-logo"] }
            """));

        result.Warnings.Should().ContainSingle(w => w.Code == OverlayMergeWarningCode.BaseVersionOutdated);
        result.Merged.ToJsonString().Should().NotContain("hdr-logo");
    }

    [Fact]
    public void Null_overlay_returns_untouched_clone()
    {
        var standard = StandardDefinition();
        var result = ReportOverlayMerger.Merge(standard, null);

        result.Warnings.Should().BeEmpty();
        result.Merged.ToJsonString().Should().Be(standard.ToJsonString());
        result.Merged.Should().NotBeSameAs(standard);
    }

    [Fact]
    public void Merged_document_still_parses_after_typical_overlay()
    {
        var result = ReportOverlayMerger.Merge(StandardDefinition(), Overlay("""
            {
              "suppress": ["hdr-logo", "kv-name"],
              "insert": [{ "id": "p1", "anchor": "summary", "position": "before",
                "element": { "id": "tenant-banner", "type": "text", "text": "Confidential" } }],
              "setProps": [{ "id": "col-qty", "props": { "header": "Amount" } }]
            }
            """));

        result.Warnings.Should().BeEmpty();
        var act = () => ReportDefinitionParser.Parse(result.Merged);
        act.Should().NotThrow();
    }
}
