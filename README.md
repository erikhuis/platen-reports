# Platen Reports

JSON-defined, SQL-driven PDF reporting for .NET, with a graphical designer.

Named for the platen — the plate in a press that pushes paper against the type.

> **Status: 0.x, pre-release.** Nothing here is stable yet. Minor versions may
> break. See [docs/versioning.md](docs/versioning.md).

## What it is

A report is a **JSON definition**: a tree of containers, rows, columns, tables
and fields, bound to data. The engine loads a definition, pulls its data through
a provider, and renders a PDF. The designer is a React component that edits
those definitions visually.

Data reaches the engine through one port — `IReportDataProvider.LoadAsync`,
returning a nested `Dictionary<string, object?>`. The engine itself touches no
database, no ORM, and no SQL. Whatever can fill that dictionary can drive a
report.

| Package | Registry | What | Status |
|---|---|---|---|
| `PlatenReports.Abstractions` | NuGet | The definition model and the ports a host implements. **No dependencies.** | shipped |
| `PlatenReports.Core` | NuGet | The engine: parser, overlay merger, path binder, template renderer, definition sources, reporting service | shipped |
| `PlatenReports.NCalc` | NuGet | `visibleIf` condition evaluation | planned |
| `PlatenReports.AspNetCore` | NuGet | Endpoint mapping, DI, and the authorization port | planned |
| `PlatenReports.Sql` | NuGet | SQL data provider | placeholder |
| `PlatenReports.Pdf` | NuGet | PDF layout + output | placeholder |
| `@platen-reports/model` | npm | Document model, overlay algebra and wire contracts. **No framework, no dependencies.** | shipped |
| `@platen-reports/designer` | npm | React report designer | placeholder |

Packages marked *placeholder* reserve the name and publish a stub; they do not do
anything yet. The engine is being extracted in phases and this table tracks it.

**Why `Abstractions` is separate:** a host implements `IReportDataProvider`. If that
interface lived in `Core`, declaring a provider would drag in Scriban and everything
else the engine happens to use. It is also what makes "the contract layer is
licence-clean" a checkable property rather than a claim — there is nothing in it to
audit.

All packages in this repository share one version and are released in lockstep.
**Equal versions are conformant** — pin both sides to the same number.

## Non-goals

These are out of scope by decision, not by omission. Scope creep into a general
reporting product is this project's top risk, and the list exists so that
"couldn't we also…" has a standing answer.

- **No charts.** No bar, line, or pie rendering. Reports are documents.
- **No banded reports.** No report/group/detail band model — the layout is a
  container tree, not a banded canvas, and the two do not merge cleanly.
- **No scheduler.** Nothing here runs reports on a timer, queues them, or mails
  them. That is the host's job, and every host already has one.
- **No free-positioning canvas.** The designer edits a flow layout. Absolute
  x/y placement is not coming; it makes definitions unmaintainable across page
  sizes and locales.
- **No joins in definitions.** A definition names a query; it does not compose
  one. Relational work belongs in SQL, authored in files, reviewed like code.

A feature request that needs one of these is not a small change to Platen
Reports — it is a different product.

## Licence

Apache-2.0. See [LICENSE](LICENSE), [NOTICE](NOTICE), and
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Extracted from the Uptimiq CMMS codebase and relicensed by the copyright
holder.

## Documentation

- [Versioning policy](docs/versioning.md) — lockstep releases, the 0.x window
- [`schemaVersion` policy](docs/schema-version.md) — format compatibility, the
  three version axes, conformance rules
