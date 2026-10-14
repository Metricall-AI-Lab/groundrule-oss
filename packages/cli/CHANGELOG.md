# @groundrule/cli

## 0.11.0

### Minor Changes

- b04cf69: Keyless signing with Sigstore (RFC 0009). In GitHub Actions, `groundrule check --upload --sigstore` (or the Action's `sigstore: "true"`, with `permissions: id-token: write`) signs the result with the job's own identity: no private key anywhere, and the signature names the repository and workflow that produced the run. `groundrule verify` checks such a run without `--key`, against Sigstore's trust root, and requires the signer to be a workflow of the run's repository. Opt-in only: the workflow identity and the result's hash go to Sigstore's public log. `signature.algorithm` is now `ed25519` or `sigstore`.

### Patch Changes

- Updated dependencies [b04cf69]
  - @groundrule/spec@0.11.0
  - @groundrule/core@0.11.0
  - @groundrule/adapters@0.11.0
  - @groundrule/evaluators@0.11.0
  - @groundrule/packs@0.11.0
  - @groundrule/reporters@0.11.0
  - @groundrule/mcp@0.11.0

## 0.10.0

### Minor Changes

- 21c3da7: Signed check runs (RFC 0008). `groundrule keys generate` creates an Ed25519 key pair; with the private key in `GROUNDRULE_SIGNING_KEY`, `check --upload` and `--write-check-run` sign each result (`--no-sign` opts out, `--sign` insists). `groundrule verify run.json --key public.pem` checks a run offline and exits 1 if it was altered. The signature covers the whole run except code snippets, so a receiver may redact them without breaking it. `signature` is optional on `CheckRun`; unsigned runs are unchanged.

### Patch Changes

- Updated dependencies [21c3da7]
  - @groundrule/spec@0.10.0
  - @groundrule/core@0.10.0
  - @groundrule/adapters@0.10.0
  - @groundrule/evaluators@0.10.0
  - @groundrule/packs@0.10.0
  - @groundrule/reporters@0.10.0
  - @groundrule/mcp@0.10.0

## 0.9.0

### Minor Changes

- f24d807: Check runs are now a compliance record (RFC 0007). An uploaded run says which rules were in effect, as a `rulebook` digest anyone with the same rules can recompute; each rule's `version`, `digest`, rollout `stage` and `enforcement` (checked, AI review or guidance); the `exceptions` that suppressed findings, with who approved them and when they expire; and `authorship`: the coding agents the change's commits declare (Claude Code, Cursor, GitHub Copilot coding agent, Codex, Aider), as counts, from commit trailers and bot authors only. `--no-authorship` leaves the agent counts out. All fields are optional, so older runs stay valid.

### Patch Changes

- Updated dependencies [f24d807]
  - @groundrule/spec@0.9.0
  - @groundrule/core@0.9.0
  - @groundrule/adapters@0.9.0
  - @groundrule/evaluators@0.9.0
  - @groundrule/packs@0.9.0
  - @groundrule/reporters@0.9.0
  - @groundrule/mcp@0.9.0

## 0.8.0

### Minor Changes

- 943c0bc: Say how each rule is enforced, in one word: **checked** (a deterministic or static-analysis check can fail a change), **AI review** (AI checks only: advisory) or **agent guidance** (no check). `groundrule standards` leads each rule with it and flags a blocker or warning rule that can't fail a change; `groundrule explain` says so and suggests adding a check; the MCP `list_standards` tool marks rules that are checked automatically at their current stage. New in `@groundrule/core`: `enforcementOf()`, `cannotFail()`.

### Patch Changes

- Updated dependencies [943c0bc]
  - @groundrule/core@0.8.0
  - @groundrule/adapters@0.8.0
  - @groundrule/evaluators@0.8.0
  - @groundrule/packs@0.8.0
  - @groundrule/reporters@0.8.0
  - @groundrule/mcp@0.8.0
  - @groundrule/spec@0.8.0

## 0.7.0

### Minor Changes

- dca0b2e: `groundrule check` can run fully offline from input files (for Groundrule's hosted checks): hidden `--offline`, `--rulebook`, `--changes`, `--pull-request`, `--commit` and `--write-check-run` options. Offline, packs from GitHub are refused instead of fetched and local sources must stay inside the repository; the result is the same as the same check in CI.

### Patch Changes

- Updated dependencies [dca0b2e]
  - @groundrule/core@0.7.0
  - @groundrule/adapters@0.7.0
  - @groundrule/evaluators@0.7.0
  - @groundrule/packs@0.7.0
  - @groundrule/reporters@0.7.0
  - @groundrule/mcp@0.7.0
  - @groundrule/spec@0.7.0

## 0.6.0

### Minor Changes

- 88fdead: `groundrule hooks` sets up GitHub Copilot too (the Copilot CLI and cloud agent): an `agentStop` hook in `.github/hooks/groundrule.json` runs the check when Copilot finishes and has it take another turn with what to fix. Agent reports (`sync --upload`) say whether it's installed. Spec: `copilot` added to the hook agents.

### Patch Changes

- c65aaa5: The GitHub Action uses `actions/setup-node@v7` and `github/codeql-action/upload-sarif@v4`, which run on Node.js 24, so workflows no longer show GitHub's Node.js 20 deprecation notice.
- Updated dependencies [88fdead]
  - @groundrule/spec@0.6.0
  - @groundrule/adapters@0.6.0
  - @groundrule/core@0.6.0
  - @groundrule/evaluators@0.6.0
  - @groundrule/packs@0.6.0
  - @groundrule/reporters@0.6.0
  - @groundrule/mcp@0.6.0

## 0.5.0

### Minor Changes

- 136141a: `groundrule sync --upload` reports what a repository delivers to coding agents (RFC 0006): which agent files the config asks for and whether they match the rulebook, which rules they carry, and whether Groundrule's stop hooks and MCP server are set up in the repository. Paths, rule IDs and yes/no only. The GitHub Action sends it whenever it has a token. New spec kind: `AgentSync`.

### Patch Changes

- Updated dependencies [136141a]
  - @groundrule/spec@0.5.0
  - @groundrule/adapters@0.5.0
  - @groundrule/core@0.5.0
  - @groundrule/evaluators@0.5.0
  - @groundrule/packs@0.5.0
  - @groundrule/reporters@0.5.0
  - @groundrule/mcp@0.5.0

## 0.4.0

### Minor Changes

- 6160365: Coding agents check their own work. `groundrule mcp` adds a `check` tool: the same check CI runs, on the agent's uncommitted changes (or since a ref, or every file), reporting only what the change introduced and how to fix it. `groundrule hooks` adds a stop hook for Claude Code, Codex, and Cursor, so the agent runs the check whenever it finishes a task and is told what to fix.

### Patch Changes

- @groundrule/adapters@0.4.0
  - @groundrule/core@0.4.0
  - @groundrule/evaluators@0.4.0
  - @groundrule/mcp@0.4.0
  - @groundrule/packs@0.4.0
  - @groundrule/reporters@0.4.0
  - @groundrule/spec@0.4.0

## 0.3.0

### Minor Changes

- baa71da: `check --upload` now sends the pull request's head commit (`pullRequest.headSha`, read from GitHub's event data), so a service that posts the result on the pull request attaches it to exactly the commit that was checked, even if someone pushed again while CI was running. Additive and optional in the `CheckRun` format (RFC 0005).

### Patch Changes

- fd4a523: The upload error for a token without scan access now names the permission as it appears in Settings → API tokens: “Upload scans and check results”.
- Updated dependencies [baa71da]
  - @groundrule/spec@0.3.0
  - @groundrule/adapters@0.3.0
  - @groundrule/core@0.3.0
  - @groundrule/evaluators@0.3.0
  - @groundrule/packs@0.3.0
  - @groundrule/reporters@0.3.0
  - @groundrule/mcp@0.3.0

## 0.2.0

### Minor Changes

- f165c4e: Add `groundrule check --upload`: sends the result of a check to your organization on Groundrule, with the repository, commit, and, in GitHub Actions, the pull request it was for (RFC 0005, new `CheckRun` document kind and JSON Schema). Snippets are one redacted line per finding, never for security rules, and `--no-snippets` sends none. A failed upload never changes the check's exit code. The GitHub Action gains `token`, `snippets` and `url` inputs to turn it on.

### Patch Changes

- Updated dependencies [f165c4e]
  - @groundrule/spec@0.2.0
  - @groundrule/core@0.2.0
  - @groundrule/adapters@0.2.0
  - @groundrule/evaluators@0.2.0
  - @groundrule/packs@0.2.0
  - @groundrule/reporters@0.2.0
  - @groundrule/mcp@0.2.0

## 0.1.1

### Patch Changes

- 2c0cfbb: Fix links in the package READMEs on npm: they pointed to files relative to the repository, which don't exist on npmjs.com. They now link to the CLI docs and to the repository on GitHub.
- Updated dependencies [2c0cfbb]
  - @groundrule/packs@0.1.1
  - @groundrule/adapters@0.1.1
  - @groundrule/core@0.1.1
  - @groundrule/evaluators@0.1.1
  - @groundrule/mcp@0.1.1
  - @groundrule/reporters@0.1.1
  - @groundrule/spec@0.1.1

## 0.1.0

### Minor Changes

- 2ee2e56: Connect repositories to the Groundrule platform: `groundrule login` (browser approval), `whoami`, `logout`, and `init --org`. With `platform:` in the config, `sync` writes your organization's rules at Teach and above, and `check` runs Enforce rules as set and Advise rules as warnings. `GROUNDRULE_TOKEN` works in CI.
- 8b17412: Add `groundrule propose "<rule>"` to propose a rule for your team to review on the Groundrule platform, and `groundrule mcp`, a Model Context Protocol server (stdio) that lets coding agents list the standards in effect and propose rules when a developer corrects them. New package `@groundrule/mcp`: a dependency-free, tools-only MCP server.
- ddf5aef: Add `groundrule scan`: observe a repository against the whole catalog without changing anything. Reports the stack, existing agent instruction files, tool configurations, and how every applicable rule would do today. `--json` prints the report (new `ScanReport` spec kind), `--upload` shares it with your organization, `--no-snippets` leaves code out.
- b4757b4: `groundrule scan` imports what a repository already has as proposals: instructions from agent files (split by heading and list item, de-duplicated, matched to similar catalog rules), linter and compiler settings that enforce catalog rules, and CODEOWNERS entries. `--no-import` leaves them out.
- 9ed48cd: `groundrule scan --upload` also tests your organization's own rules that have checks, including drafts, against the repository, so their impact shows on the platform before anyone publishes them. An organization rule replaces a catalog rule with the same ID in the scan. Platforms without this feature, or any error fetching the rules, leave the scan to the catalog.

### Patch Changes

- 2d4452e: `groundrule whoami` now finds logins made with `login --url` from any folder, and an empty `GROUNDRULE_URL` counts as unset. The MCP `list_standards` tool shows each organization rule's rollout stage, so agents know which findings only warn.
- Updated dependencies [2d4452e]
- Updated dependencies [2ee2e56]
- Updated dependencies [8b17412]
- Updated dependencies [ddf5aef]
- Updated dependencies [b4757b4]
  - @groundrule/adapters@0.1.0
  - @groundrule/spec@0.1.0
  - @groundrule/core@0.1.0
  - @groundrule/mcp@0.1.0
  - @groundrule/packs@0.1.0
  - @groundrule/evaluators@0.1.0
  - @groundrule/reporters@0.1.0
