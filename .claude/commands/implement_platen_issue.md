---
description: Implement a platen-reports issue end-to-end — branch, code, tests, PR, code review, security review, docs, squash-merge.
argument-hint: <issue-number>
---

# Implement Platen Reports issue #$ARGUMENTS

Implement `erikhuis/platen-reports` issue #$ARGUMENTS end-to-end. **Issue and code both live in
this repository**, so `gh` needs no `--repo`, a bare `#$ARGUMENTS` in a commit resolves
correctly, and `Closes #$ARGUMENTS` in the PR body actually closes the issue.

## 0. Confirm you are in the right repository — do this first

This command works on **`erikhuis/platen-reports` only**. Its sibling,
`/implement_assetworld_issue`, works on AssetWorld only. Neither may touch the other's tree: an
issue number means different things in each, so a misdirected run edits real code against the
wrong issue.

```bash
git remote get-url origin
```

It must contain `erikhuis/platen-reports`. **If it does not, stop immediately** — change nothing,
create no branch, and tell the user which repository the session is actually in and which command
they want. Do not "adapt" by adding `--repo` flags or reaching across into another checkout.

Do every step in order. Commit and push as soon as it compiles and tests pass — before review,
security and docs — so a dropped connection never loses work.

## 1. Read the issue

`gh issue view $ARGUMENTS` — the full body and comments. Satisfy every acceptance criterion, and
say so explicitly for each one when you report back.

## 2. Board lane and branch

Move the issue to **In progress** on the *Platen Reports Kanban* board (project #2), which is
where this repo's work is planned:

```bash
bash .claude/scripts/platen-lane.sh $ARGUMENTS "In progress"
```

Then branch.

Never commit on `main`:

```bash
git fetch origin main && git switch -c fix/$ARGUMENTS-<short-slug> origin/main
```

Confirm the clone is clean and in sync first. **If `git status` is dirty, stop and look** — a
deep review run in another session leaves uncommitted changes in the working tree, and this has
happened on four separate slices. Do not stash or discard them without reading them.

## 3. Implement

- Repo conventions are `.editorconfig` (braces enforced **as errors**), `Directory.Build.props`
  (warnings-as-errors, XML docs required on public members), `Directory.Packages.props` (central
  versions, permissive licences only) and `docs/`. There is no `CLAUDE.md` here, and AssetWorld's
  does not apply.
- `dotnet format style <project> --severity info` fixes the brace violations rather than hand-editing.
- Tests for every non-trivial behaviour: xUnit + FluentAssertions on .NET, vitest on npm.
- **`PlatenReports.Abstractions` must keep zero `PackageReference`.** Assert it; a test enforces it.

## 4. Verify locally

```bash
dotnet build && dotnet test
pnpm -r --filter './packages/**' build      # BEFORE typecheck — see below
pnpm -r --filter './packages/**' typecheck
pnpm -r --filter './packages/**' test
```

**Build before typecheck.** `@platen-reports/designer` typechecks against
`@platen-reports/model`'s *emitted* declarations, so with no `dist/` every model import resolves
to nothing — measured at 148 phantom "implicitly has an 'any' type" errors naming files nowhere
near the cause.

**No preview step.** This repo has no runnable app. Say so and skip; do not invent a check, and
do not start AssetWorld's dev server to "verify" package code.

**If you touched anything a consumer receives**, assert it against `dist/`, not source:
`'use client'` survives the bundle, no stylesheet ships, peers stay peers, the `exports` map
resolves. These fail only for consumers, so review cannot catch them.

## 5. Commit and push

Conventional commits, `Co-Authored-By: Claude <noreply@anthropic.com>`, stage only what you
changed. `#$ARGUMENTS` in the subject or body is correct here and links properly.

## 6. Open the PR

`gh pr create --base main` with a Summary + Test plan. Put `Closes #$ARGUMENTS` in the body — it
works, both being in this repo.

## 7. Code review, then fix

Review the diff yourself: `gh pr diff <PR#>` plus `git diff origin/main...HEAD`. Look for
correctness gaps, missing edge cases, unhandled errors, missing tests. Post the findings as a PR
comment, then fix the substantive ones and say how.

**Do NOT call the `code-review` skill** — it is flagged `disable-model-invocation` and the Skill
tool refuses it. The deeper pass is the user's, at the gate below.

**Do not invent findings.** A pass that found nothing says so.

## 8. Security review, then fix

Do the pass yourself. Cover:

- **Published-content leakage.** This repo is PUBLIC and every line is a publication. Check for
  host-internal content: customer or tenant names, seed accounts, internal URLs and ports,
  `AssetWorld.*` namespaces, product copy, anything naming an employee. **You cannot un-publish a
  push.** When in doubt, leave it out and say so.
- **Licence hygiene.** Every new dependency is permissive and appears in
  `THIRD-PARTY-NOTICES.md` — which covers **runtime** deps on both registries, not test-only ones.
  `Abstractions` stays dependency-free.
- **Input validation** on anything a host feeds the parser or merger, and the `schemaVersion`
  range rules.
- **The `IReportAuthorizer` port** — a default-allow implementation must stay opt-in, named for
  what it does, and warn at startup.
- **Template evaluation sandboxing** (Scriban, NCalc) and, once SQL lands, injection.
- Secrets in CI workflows and publish tokens.

**Do NOT invoke the `security-review` skill mid-run** — it launches in-line and strands steps
9–10. `/security-review` is offered to the user at the gate.

## 9. Docs

Update `README.md` and `docs/` when the change affects a **consumer**: public API, package
layout, versioning or `schemaVersion` behaviour, host wiring. Pure internal change: say so and skip.

If you added or renamed a package, update **both** the README package table and
`.github/workflows/publish.yml` — its verify step names artefacts explicitly and has silently
gone stale before.

## 10. Pre-merge gate

Steps 1–9 run unattended. Then **stop** and end your turn with exactly this ask, filled in:

> Ready to merge PR #\<N\>. For the deep pass, run `/code-review high` — it reviews this repo, so
> it works from here directly. I'll fold the findings in and merge. Or say **merge** to skip it.
> (`/security-review` is also available.)

This is the run's only planned stop. Do not merge past it, and do not ask anything else at the
same time. When the review lands, treat it as step 7 findings: post them, fix the substantive
ones, push, comment, then merge.

**A review that reviewed nothing is not a clean review.** If it says there was nothing to review
or asks which branch to look at, say the deep review did not run and why — never report that as
"no findings".

## 11. Merge

**CI here is real** — check it, do not skip it:

```bash
gh pr checks <PR#> --watch
gh pr merge <PR#> --squash --delete-branch
git switch main && git pull --ff-only && git branch -D fix/$ARGUMENTS-<slug>
bash .claude/scripts/platen-lane.sh $ARGUMENTS "Done"
```

`Closes #$ARGUMENTS` closes the issue on merge, so do not close it by hand. Closing may also move
the board item on its own; the lane call is harmless either way and makes the intent explicit.

Red CI means something is actually broken; read the log and fix it. If `main` moved since the
branch was cut, rebase and re-run build and tests — the green you reported was measured against a
different base.

After merging, **check the working tree again** before switching branches, for the same
uncommitted-review-changes reason as step 2.

## Hard rules

- Never `git push --force` to anything but your own feature branch.
- Never bypass hooks or commit signing. Commits here are unsigned by config — do not force
  `-c commit.gpgsign=true`.
- Never commit a secret.
- **`pnpm pack`, never `npm pack`.** The designer depends on the model with `workspace:*` and only
  pnpm rewrites that to a real version; `npm pack` publishes the literal string and the package
  cannot be installed.
- **Never touch the AssetWorld checkout.** If a change seems to need one, that is a second issue
  in that repo, run with `/implement_assetworld_issue` — say so and stop rather than reaching
  across.
- If you cannot finish a step, comment on the issue describing where you stopped, push what you
  have, and stop. Do not merge half-broken code.

## Reporting back

The run is INCOMPLETE until `gh pr view <PR#> --json state` reads `MERGED`. Pausing at the gate is
the one sanctioned stop and is not incomplete — end there with the ask, not a summary.

Otherwise close with under 300 words: PR URL and merge SHA, files changed, tests added, each
acceptance criterion and how it was verified, any deviations and why, and follow-ups filed.

Begin.
