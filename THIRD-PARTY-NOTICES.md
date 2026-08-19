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
- **Version at extraction:** 7.2.0. **Now referenced at 7.2.6** — 7.2.0 carries three
  published advisories, one of them high severity (GHSA-7jvp-hj45-2f2m,
  GHSA-6q7j-xr26-3h2c, GHSA-q6rr-fm2g-g5x8), all fixed in the 7.2.x line.
- **Licence:** BSD 2-Clause "Simplified" License
- **Upstream:** https://github.com/scriban/scriban
- **Licence text:** https://github.com/scriban/scriban/blob/master/license.txt

## Microsoft.Extensions.DependencyInjection.Abstractions

- **Purpose:** the `IServiceCollection` that `PlatenReports.NCalc`'s one-line
  `AddNCalcReportConditions()` opt-in extends. Abstractions only — the packages
  reference the contract assembly, never a container implementation, so a host is
  free to use any DI container or none.
- **Version at extraction:** 10.0.7
- **Licence:** MIT License
- **Upstream:** https://github.com/dotnet/runtime
- **Licence text:** https://github.com/dotnet/runtime/blob/main/LICENSE.TXT

## Microsoft.Extensions.Logging.Abstractions

- **Purpose:** the `ILogger<T>` the engine writes merge warnings and render failures to.
  Abstractions only — the engine takes no logging *implementation*, so a host keeps its own.
- **Version at extraction:** 10.0.7 — raised from 10.0.0 by NCalcSync, whose
  transitive floor is 10.0.7; central transitive pinning makes a lower version a
  restore error rather than a silent downgrade.
- **Licence:** MIT License
- **Upstream:** https://github.com/dotnet/runtime
- **Licence text:** https://github.com/dotnet/runtime/blob/main/LICENSE.TXT

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

## lucide-react

- **Purpose:** the icon set the report designer renders. A real dependency rather
  than a peer: it draws SVG and holds no shared state, so two copies in a host's
  tree are wasteful but harmless — unlike React, MUI or emotion.
- **Version at extraction:** 1.33.0
- **Licence:** ISC License
- **Upstream:** https://github.com/lucide-icons/lucide
- **Licence text:** https://github.com/lucide-icons/lucide/blob/main/LICENSE

## Peer dependencies of `@platen-reports/designer`

React, `react-dom`, `@mui/material`, `@emotion/react` and `@emotion/styled` are
**peer** dependencies: the designer is compiled against them but ships none of
them, and a host supplies its own. They are listed here for completeness rather
than because this project distributes them — all are MIT.

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

This file covers **runtime** dependencies on both sides — NuGet and npm — meaning
what a consumer of the published packages actually acquires. Test-only packages
(xunit, FluentAssertions, `Microsoft.Extensions.DependencyInjection`,
`Microsoft.AspNetCore.TestHost`, vitest, Testing Library) ship in nothing and are
deliberately not listed.

Re-verify licence identifiers at each release rather than trusting this file:
upstream projects do relicense. `dotnet list package --include-transitive` plus
the NuGet package metadata (`PackageLicenseExpression`) is the fastest check for
the .NET side; `npm ls --all` and `license-checker` for the npm packages.
