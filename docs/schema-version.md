# `schemaVersion` policy

Report definitions carry a `schemaVersion` integer. This document defines what
it means, when it changes, and what an engine must do when it meets a value it
does not recognise.

## Three independent axes

Do not conflate these. They move at different rates, for different reasons, and
are owned by different people.

| Axis | Owner | Changes when |
|---|---|---|
| **Package SemVer** | this project | any public API change — see [versioning.md](versioning.md) |
| **`schemaVersion`** | this project | a **breaking** report-definition format change, and only then |
| **Per-report definition version** | the **host application** | whenever the host wants; Platen Reports never reads or interprets it |

A package release does not imply a `schemaVersion` bump. The overwhelming
majority of releases will not touch it. That is the intended ratio — a
`schemaVersion` bump is a serious event.

## What does *not* bump `schemaVersion`

**Additive properties.** A new optional property on an existing element type is
a compatible change. Old definitions keep working; new definitions read by an
older engine lose the property and nothing else.

This is the common case and it must stay cheap, or the format ossifies.

## Unknown-input rules

The asymmetry here is deliberate and load-bearing:

- **Unknown *properties* are ignored, with a warning.** A definition written for
  a newer engine still renders on an older one, minus whatever the new property
  did. Warn so the degradation is visible; do not fail.
- **Unknown *element types* are fatal.** An element the engine cannot render is
  not a cosmetic loss — it is a hole in the document, and a report with a
  silently missing section is worse than no report. Fail loudly.

An engine that treats an unknown element type as a warning is non-conformant.

## What *does* bump `schemaVersion`

A change that would make an existing valid definition render incorrectly, or
stop rendering, under the new engine. Removing a property, changing a
property's meaning or units, changing default behaviour, or altering the
element tree's structural rules.

A `schemaVersion` bump carries hard obligations:

1. **It requires a package major version.** No exceptions, including during 0.x
   — the 0.x "minor may break" allowance covers API surface, not the persisted
   format. Definitions outlive packages.
2. **The engine must support a *range*, not a value.** An engine advertising
   support for `{1, 2}` accepts both.
3. **The engine must ship an in-memory upgrader** that lifts older definitions
   to the current shape at load time. Upgrading is never a migration the host
   has to run, and never rewrites the stored definition — it happens on the way
   in, every time.

> **Implementation note carried over from the origin codebase.** The parser's
> supported version was a `const int` compared with `!=`. That shape makes the
> range requirement above unrepresentable and turns every bump into a hard
> break for stored definitions. It must be a supported **set** — `{1, 2}` — and
> never a single value that gets incremented.

## Element ids are a public contract

Element `id` values in **shipped** definitions are part of the public contract,
across definition versions.

Hosts key overlays, customisations, and tests off those ids. Renaming an id in a
shipped definition silently detaches every overlay that referenced it — the
overlay does not error, it just stops applying, which is the worst available
failure mode.

Treat an id rename in a shipped definition as a breaking change. New elements
get new ids; removed elements leave their ids retired, not recycled.

Ids in *host-authored* definitions are the host's business.

## Conformance

For any engine and designer at the same package version:

- Both support the same `schemaVersion` range.
- A definition at any supported version loads, upgrades in memory, and renders.
- A definition above the supported range is rejected with an error naming the
  required engine version — not a partial render.
- A definition below the supported range is rejected only if the upgrader was
  deliberately dropped, which is itself a major-version change and a CHANGELOG
  entry.
