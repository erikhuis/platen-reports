# Provenance

Platen Reports was extracted from the **Uptimiq** CMMS codebase in 2026.

Original authorship: **Erik Huisman / CTO Consultancy**.
Relicensed **Apache-2.0** by the copyright holder.

## Basis for the relicensing

Every commit touching the reporting engine and designer in the origin codebase has a
single human author, Erik Huisman. The only other names appearing in that history are
`Co-Authored-By` trailers for AI coding assistants, which are tool attribution rather
than third-party copyright claims. There is no external contributor whose permission
would be required, so the copyright holder relicensed the work unilaterally.

The audit backing that statement was run over every path holding reporting code in the
origin repository — the application-layer engine, its infrastructure adapters, the
shared reporting model and the designer UI — across the full history of each.

## Method: clean-room copy, not a history rewrite

The code arrived here as a **copy**, in fresh commits. Its origin history was deliberately
not filtered across, for three reasons:

1. **The history carried little.** The reporting paths in the origin repository amounted
   to a handful of commits.
2. **Blame continuity breaks anyway.** Files were re-namespaced from `AssetWorld.*` to
   `PlatenReports.*`, split across new package boundaries, and in places rewritten. Line
   history would not have survived the move.
3. **Published history cannot be recalled.** Filtering a private commercial monorepo into
   a public one means auditing every surviving blob, commit message and author email for
   secrets and internal content. That audit costs more than the history is worth, and
   getting it wrong is unrecoverable.

Each carve commit states which files it brought over and from where, which is the
provenance that actually matters for a licence audit.

## What is *not* here

Uptimiq-specific implementations stayed behind: its data providers, its persistence
adapters, its authorization and tenancy. This project ships the contracts those
implement, and nothing that names or depends on any particular host.
