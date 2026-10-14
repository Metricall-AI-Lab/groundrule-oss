# @groundrule/core

## 0.15.0

### Minor Changes

- ab2cbb5: Architecture discovery in `groundrule scan` (RFC 0011): the boundaries and package gates a repository already keeps, read from its import graph, as proposals with the files that would fail each today. `ScanImports` gains `boundaries` and `gates`; the import scanner and resolver move to `@groundrule/core` (`buildImportGraph`, `discoverArchitecture`), and the `imports` evaluator uses them.

### Patch Changes

- Updated dependencies [ab2cbb5]
  - @groundrule/spec@0.15.0

## 0.14.0

### Patch Changes

- @groundrule/spec@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [84ca988]
  - @groundrule/spec@0.13.0

## 0.12.0

### Patch Changes

- @groundrule/spec@0.12.0

## 0.11.0

### Minor Changes

- b04cf69: Keyless signing with Sigstore (RFC 0009). In GitHub Actions, `groundrule check --upload --sigstore` (or the Action's `sigstore: "true"`, with `permissions: id-token: write`) signs the result with the job's own identity: no private key anywhere, and the signature names the repository and workflow that produced the run. `groundrule verify` checks such a run without `--key`, against Sigstore's trust root, and requires the signer to be a workflow of the run's repository. Opt-in only: the workflow identity and the result's hash go to Sigstore's public log. `signature.algorithm` is now `ed25519` or `sigstore`.

### Patch Changes

- Updated dependencies [b04cf69]
  - @groundrule/spec@0.11.0

## 0.10.0

### Minor Changes

- 21c3da7: Signed check runs (RFC 0008). `groundrule keys generate` creates an Ed25519 key pair; with the private key in `GROUNDRULE_SIGNING_KEY`, `check --upload` and `--write-check-run` sign each result (`--no-sign` opts out, `--sign` insists). `groundrule verify run.json --key public.pem` checks a run offline and exits 1 if it was altered. The signature covers the whole run except code snippets, so a receiver may redact them without breaking it. `signature` is optional on `CheckRun`; unsigned runs are unchanged.

### Patch Changes

- Updated dependencies [21c3da7]
  - @groundrule/spec@0.10.0

## 0.9.0

### Minor Changes

- f24d807: Check runs are now a compliance record (RFC 0007). An uploaded run says which rules were in effect, as a `rulebook` digest anyone with the same rules can recompute; each rule's `version`, `digest`, rollout `stage` and `enforcement` (checked, AI review or guidance); the `exceptions` that suppressed findings, with who approved them and when they expire; and `authorship`: the coding agents the change's commits declare (Claude Code, Cursor, GitHub Copilot coding agent, Codex, Aider), as counts, from commit trailers and bot authors only. `--no-authorship` leaves the agent counts out. All fields are optional, so older runs stay valid.

### Patch Changes

- Updated dependencies [f24d807]
  - @groundrule/spec@0.9.0

## 0.8.0

### Minor Changes

- 943c0bc: Say how each rule is enforced, in one word: **checked** (a deterministic or static-analysis check can fail a change), **AI review** (AI checks only: advisory) or **agent guidance** (no check). `groundrule standards` leads each rule with it and flags a blocker or warning rule that can't fail a change; `groundrule explain` says so and suggests adding a check; the MCP `list_standards` tool marks rules that are checked automatically at their current stage. New in `@groundrule/core`: `enforcementOf()`, `cannotFail()`.

### Patch Changes

- @groundrule/spec@0.8.0

## 0.7.0

### Minor Changes

- dca0b2e: `groundrule check` can run fully offline from input files (for Groundrule's hosted checks): hidden `--offline`, `--rulebook`, `--changes`, `--pull-request`, `--commit` and `--write-check-run` options. Offline, packs from GitHub are refused instead of fetched and local sources must stay inside the repository; the result is the same as the same check in CI.

### Patch Changes

- @groundrule/spec@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [88fdead]
  - @groundrule/spec@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [136141a]
  - @groundrule/spec@0.5.0

## 0.4.0

### Patch Changes

- @groundrule/spec@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [baa71da]
  - @groundrule/spec@0.3.0

## 0.2.0

### Minor Changes

- f165c4e: Add `groundrule check --upload`: sends the result of a check to your organization on Groundrule, with the repository, commit, and, in GitHub Actions, the pull request it was for (RFC 0005, new `CheckRun` document kind and JSON Schema). Snippets are one redacted line per finding, never for security rules, and `--no-snippets` sends none. A failed upload never changes the check's exit code. The GitHub Action gains `token`, `snippets` and `url` inputs to turn it on.

### Patch Changes

- Updated dependencies [f165c4e]
  - @groundrule/spec@0.2.0

## 0.1.1

### Patch Changes

- @groundrule/spec@0.1.1

## 0.1.0

### Minor Changes

- 2ee2e56: Connect repositories to the Groundrule platform: `groundrule login` (browser approval), `whoami`, `logout`, and `init --org`. With `platform:` in the config, `sync` writes your organization's rules at Teach and above, and `check` runs Enforce rules as set and Advise rules as warnings. `GROUNDRULE_TOKEN` works in CI.
- ddf5aef: Add `groundrule scan`: observe a repository against the whole catalog without changing anything. Reports the stack, existing agent instruction files, tool configurations, and how every applicable rule would do today. `--json` prints the report (new `ScanReport` spec kind), `--upload` shares it with your organization, `--no-snippets` leaves code out.
- b4757b4: `groundrule scan` imports what a repository already has as proposals: instructions from agent files (split by heading and list item, de-duplicated, matched to similar catalog rules), linter and compiler settings that enforce catalog rules, and CODEOWNERS entries. `--no-import` leaves them out.

### Patch Changes

- Updated dependencies [2ee2e56]
- Updated dependencies [ddf5aef]
- Updated dependencies [b4757b4]
  - @groundrule/spec@0.1.0
