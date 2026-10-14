# @groundrule/core

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
