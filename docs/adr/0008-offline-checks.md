# ADR 0008: Offline checks, for hosted runs

- **Status:** Accepted
- **Date:** 2026-10-13

## Context

Groundrule's platform can check a pull request without the team's CI: its worker runs this engine in a sandbox with no network and no git history (ADR 0029 in the platform repository). The engine has to give the same answer it gives in CI, from inputs handed over as files, and it must never try to reach the network or read outside the repository it's checking.

## Decision

`groundrule check` takes hidden options for this. They're not shown in `--help`, because they're for the platform's worker, not for people:

| Option | What it replaces |
|---|---|
| `--offline` | Never reach the network: no platform calls, and packs from GitHub are refused, not fetched. Local `extends` paths must stay inside the repository. Bundled packs (`groundrule:`) still work |
| `--rulebook <file>` | Fetching the organization's rulebook (`GET /v1/cli/rulebook`). It goes through the same conversion as a fetched one (`standardsFromRulebook`) and must be for the organization in the config |
| `--changes <file>` | Asking git for the diff: changed files with their changed lines, as `runChecks` takes them |
| `--pull-request <file>`, `--commit <sha>` | Reading CI's event data and `git rev-parse` |
| `--write-check-run <file>` | Writes the result as a `CheckRun` (RFC 0005), the same format `--upload` sends. `--no-snippets` leaves code out |

Every input file is validated before use: JSON, strict shapes, repository-relative paths only, and bounded sizes. `--offline` can't be combined with `--upload`.

No spec change: the `CheckRun` format is the same as from CI.

## Consequences

- A hosted check and a CI check of the same change give the same findings. A test checks this line for line.
- The platform must write the base branch's `.groundrule/` into the workspace, and provide the rulebook, changes and pull request. The engine trusts only what it's given, and only after validating it.
- Packs from GitHub aren't available to hosted checks. Teams use bundled packs or their organization's rulebook.
