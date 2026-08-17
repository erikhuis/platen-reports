# @platen-reports/model

The report definition model, the customisation-overlay algebra, and the wire contracts for
[Platen Reports](https://github.com/erikhuis/platen-reports).

**No framework. No runtime dependencies.**

## Why this is a separate package

Two consumers need the model without needing a UI:

- **`@platen-reports/designer`** is React, but reading, validating or patching a definition
  should not require React of anyone else.
- **The conformance suite** runs this overlay merger and the C# one over the same fixtures in
  plain Node and compares the results. That only works if the model runs outside a browser.

## What is in it

| | |
|---|---|
| **Document model** | The eleven element types, page setup, styles, localized text, parameters. Mirrors what the engine's parser accepts, so a designer cannot build a shape the parser rejects. |
| **Overlay algebra** | `suppress` / `insert` / `setProps`, the allowlist that bounds them, and `mergePreview` — a client-side mirror of the engine's merge, used to show an author the result before saving. |
| **Direct authoring** | Pure helpers that mutate a definition document itself, for publishing rather than patching. |
| **Wire contracts** | The shapes a host's reporting API speaks, and `ReportsApiClient` — the port the designer calls, which the host binds to its own transport. |

## Install

```sh
npm install @platen-reports/model
```

## Use

```ts
import { mergePreview, validateInserted, serializeOverlay } from '@platen-reports/model';

const preview = mergePreview(publishedDefinition, overlay);
const problems = validateInserted(preview);

if (problems.length === 0) {
  await api.putOverlay(reportKey, serializeOverlay(overlay), true);
}
```

Everything is exported from the package root. Deep imports into individual modules are not part
of the public surface and may be reorganised.

## Versioning

Every package in this repository shares one version and is released in lockstep. **Equal
versions are conformant** — pin the model and the engine to the same number. See
[docs/versioning.md](../../docs/versioning.md) and
[docs/schema-version.md](../../docs/schema-version.md), which is the separate question of which
*definition formats* an engine accepts.

## Licence

Apache-2.0. See [PROVENANCE.md](../../PROVENANCE.md) for the extraction history.
