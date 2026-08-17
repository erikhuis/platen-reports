# Versioning policy

## One version for the whole repository

Every package this repository publishes — the .NET packages under
`PlatenReports.*` and the npm packages under `@platen-reports/*` — shares a
**single version number**, released in lockstep, driven by one `<VersionPrefix>`
in `Directory.Build.props`.

There is no per-package version drift, ever. A release bumps everything, whether
or not a given package changed.

```xml
<!-- Directory.Build.props — the only place a version is written -->
<VersionPrefix>0.1.0</VersionPrefix>
```

The npm packages read the same value at pack time rather than carrying their own
(see `.github/workflows/publish.yml`). The `version` field committed in their
`package.json` is a placeholder; the release workflow overwrites it from the tag
and never commits the result.

## Why lockstep

The question this policy exists to answer is *"which designer version matches my
engine?"* Independent versioning makes that a compatibility matrix that someone
has to maintain, publish, and be wrong about. Lockstep makes it trivial:

> **Equal versions are conformant.** `@platen-reports/designer@1.4.2` is
> guaranteed to interoperate with `PlatenReports.Core@1.4.2`. Nothing else is
> guaranteed.

That guarantee is the whole point. It is cheap to keep — the cost is publishing
a few unchanged packages per release — and expensive to reintroduce later, so it
starts on day one.

Consumers should pin both sides to the same version and upgrade them together.

## The 0.x period

The project stays on `0.x` for the first **3–6 months** of public life.

> **During 0.x, a minor version bump may contain breaking changes.**

This is the standard SemVer 0.x escape hatch and it is used deliberately: the
API surface is being shaped by real consumers during this window, and pretending
otherwise would mean either a stream of major versions or a frozen bad design.

What 0.x does *not* excuse: silent breakage. Every breaking change in 0.x gets a
CHANGELOG entry and a migration note, exactly as it would after 1.0.

Leaving 0.x is a deliberate decision, not a milestone that arrives on its own.
The bar is: the element model has survived a second host, and no breaking change
has been needed for a full release cycle.

## After 1.0

Ordinary SemVer:

| Change | Bump |
|---|---|
| Breaking API change, or a `schemaVersion` bump (see [schema-version.md](schema-version.md)) | **major** |
| New API, backwards compatible | **minor** |
| Fix only, no API change | **patch** |

"API" means the public surface of any published package in this repository —
including the npm packages' exported types. A change that breaks the designer's
public props is a major, the same as one that breaks a .NET interface.

## Prereleases

Prerelease builds use `-alpha.N` / `-beta.N` / `-rc.N` suffixes via
`<VersionSuffix>`, applied to the same shared `<VersionPrefix>`. CI publishes
prereleases from tagged commits only.

NuGet keeps prereleases out of ordinary resolution by itself. npm does not — it
installs whatever `latest` points at — so a prerelease is published under an npm
dist-tag named for its channel, leaving `latest` on the newest stable:

```
npm install @platen-reports/designer          # newest stable
npm install @platen-reports/designer@alpha    # newest alpha
```

## Relationship to the other two version axes

This document governs **package SemVer** only. Two other numbers exist and are
deliberately independent of it:

- **`schemaVersion`** — the report-definition format. Governed by
  [schema-version.md](schema-version.md).
- **Per-report definition version** — owned by the host application, not by
  this project. Platen Reports never interprets it.

Conflating the three is the failure mode this split exists to prevent. A package
release does not imply a format change, and a format change is not the host's
report version.
