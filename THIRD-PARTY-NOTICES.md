# Third-party notices

Platen Reports depends on the following third-party components. Each is
distributed under its own licence, reproduced or linked below. Versions are
those current at the time of extraction (2026-08); the authoritative list for
any given release is that release's package manifest.

Every dependency here is under a permissive licence compatible with
Apache-2.0 redistribution. **Adding a dependency under a copyleft or
source-available licence is a project-level decision, not a routine one** — see
the non-goals in the README.

---

## Scriban

- **Purpose:** expression and template evaluation in report definitions.
- **Version at extraction:** 7.2.0
- **Licence:** BSD 2-Clause "Simplified" License
- **Upstream:** https://github.com/scriban/scriban
- **Licence text:** https://github.com/scriban/scriban/blob/master/license.txt

## Markdig

- **Purpose:** parsing markdown-lite content in bound report fields.
- **Version at extraction:** 1.3.2
- **Licence:** BSD 2-Clause "Simplified" License
- **Upstream:** https://github.com/xoofx/markdig
- **Licence text:** https://github.com/xoofx/markdig/blob/master/license.txt

## NCalcSync

- **Purpose:** synchronous numeric/boolean expression evaluation for report
  conditions.
- **Version at extraction:** 6.3.0
- **Licence:** MIT License
- **Upstream:** https://github.com/ncalc/ncalc
- **Licence text:** https://github.com/ncalc/ncalc/blob/master/LICENSE.txt

## PDFsharp

- **Purpose:** PDF output primitives for the layout engine.
- **Version at extraction:** not yet referenced — planned replacement for the
  original renderer.
- **Licence:** MIT License
- **Upstream:** https://github.com/empira/PDFsharp
- **Licence text:** https://github.com/empira/PDFsharp/blob/master/LICENSE.md

---

## Deliberately absent: QuestPDF

The renderer in the origin codebase was built on **QuestPDF**, which is *not*
distributed here and must not be reintroduced. QuestPDF's Community licence is
not a permissive open-source licence — it carries a revenue-based commercial
requirement that would propagate to every downstream consumer of an Apache-2.0
library. Replacing it is the reason PDFsharp appears above.

If you are porting code from the origin repository, check that nothing you bring
across references `QuestPDF.*`.

---

## Maintaining this file

Re-verify licence identifiers at each release rather than trusting this file:
upstream projects do relicense. `dotnet list package --include-transitive` plus
the NuGet package metadata (`PackageLicenseExpression`) is the fastest check for
the .NET side; `npm ls --all` and `license-checker` for the npm packages.
