# @groundrule/spec

## 0.18.0

### Minor Changes

- 89ee403: AI checks (RFC 0013): the `llm` evaluator's options are now `question`, `include`, `exclude` and `minConfidence`, answered by Groundrule's hosted checks over the changed lines of the files the rule names; locally and in CI the rule is reported as not run. `groundrule check --ai-requests <file>` writes the review requests (`AiReviewRequests`: hunks with context, secrets redacted, within per-run limits) for the hosted worker.

## 0.17.0

No changes in this release.

## 0.16.0

### Minor Changes

- 42c9562: Agent check reports (RFC 0012): in a repository connected to its workspace, the stop hook and the MCP `check` tool send the counts per rule they found (agent, mode, files, rules, whether the agent was stopped) to `POST /v1/cli/agent-checks`, after the agent has its answer and never slowing it down. Never a path, a line or code. `platform.reports: none` turns it off; `groundrule doctor` says which applies. New document kind `AgentCheck`.

### Patch Changes

- 1d1a810: `AgentCheck.metadata.generatedAt` is a timestamp, as the CLI sends it, not a calendar date.

## 0.15.0

### Minor Changes

- ab2cbb5: Architecture discovery in `groundrule scan` (RFC 0011): the boundaries and package gates a repository already keeps, read from its import graph, as proposals with the files that would fail each today. `ScanImports` gains `boundaries` and `gates`; the import scanner and resolver move to `@groundrule/core` (`buildImportGraph`, `discoverArchitecture`), and the `imports` evaluator uses them.

## 0.14.0

No changes in this release.

## 0.13.0

### Minor Changes

- 84ca988: CodeRabbit as a sync target (RFC 0010). With `coderabbit` in the config's `targets`, `groundrule sync` writes the rulebook into `.coderabbit.yaml`: review guidance per path scope, and CodeRabbit's custom pre-merge checks (advisory, at most five) for rules no deterministic check covers. Only Groundrule's own entries are managed; the team's settings, entries and comments stay as they are, and removing the target removes only Groundrule's entries. `groundrule init` picks the target up when a `.coderabbit.yaml` exists.

## 0.12.0

No changes in this release.

## 0.11.0

### Minor Changes

- b04cf69: Keyless signing with Sigstore (RFC 0009). In GitHub Actions, `groundrule check --upload --sigstore` (or the Action's `sigstore: "true"`, with `permissions: id-token: write`) signs the result with the job's own identity: no private key anywhere, and the signature names the repository and workflow that produced the run. `groundrule verify` checks such a run without `--key`, against Sigstore's trust root, and requires the signer to be a workflow of the run's repository. Opt-in only: the workflow identity and the result's hash go to Sigstore's public log. `signature.algorithm` is now `ed25519` or `sigstore`.

## 0.10.0

### Minor Changes

- 21c3da7: Signed check runs (RFC 0008). `groundrule keys generate` creates an Ed25519 key pair; with the private key in `GROUNDRULE_SIGNING_KEY`, `check --upload` and `--write-check-run` sign each result (`--no-sign` opts out, `--sign` insists). `groundrule verify run.json --key public.pem` checks a run offline and exits 1 if it was altered. The signature covers the whole run except code snippets, so a receiver may redact them without breaking it. `signature` is optional on `CheckRun`; unsigned runs are unchanged.

## 0.9.0

### Minor Changes

- f24d807: Check runs are now a compliance record (RFC 0007). An uploaded run says which rules were in effect, as a `rulebook` digest anyone with the same rules can recompute; each rule's `version`, `digest`, rollout `stage` and `enforcement` (checked, AI review or guidance); the `exceptions` that suppressed findings, with who approved them and when they expire; and `authorship`: the coding agents the change's commits declare (Claude Code, Cursor, GitHub Copilot coding agent, Codex, Aider), as counts, from commit trailers and bot authors only. `--no-authorship` leaves the agent counts out. All fields are optional, so older runs stay valid.

## 0.8.0

No changes in this release.

## 0.7.0

No changes in this release.

## 0.6.0

### Minor Changes

- 88fdead: `groundrule hooks` sets up GitHub Copilot too (the Copilot CLI and cloud agent): an `agentStop` hook in `.github/hooks/groundrule.json` runs the check when Copilot finishes and has it take another turn with what to fix. Agent reports (`sync --upload`) say whether it's installed. Spec: `copilot` added to the hook agents.

## 0.5.0

### Minor Changes

- 136141a: `groundrule sync --upload` reports what a repository delivers to coding agents (RFC 0006): which agent files the config asks for and whether they match the rulebook, which rules they carry, and whether Groundrule's stop hooks and MCP server are set up in the repository. Paths, rule IDs and yes/no only. The GitHub Action sends it whenever it has a token. New spec kind: `AgentSync`.

## 0.4.0

No changes in this release.

## 0.3.0

### Minor Changes

- baa71da: `check --upload` now sends the pull request's head commit (`pullRequest.headSha`, read from GitHub's event data), so a service that posts the result on the pull request attaches it to exactly the commit that was checked, even if someone pushed again while CI was running. Additive and optional in the `CheckRun` format (RFC 0005).

## 0.2.0

### Minor Changes

- f165c4e: Add `groundrule check --upload`: sends the result of a check to your organization on Groundrule, with the repository, commit, and, in GitHub Actions, the pull request it was for (RFC 0005, new `CheckRun` document kind and JSON Schema). Snippets are one redacted line per finding, never for security rules, and `--no-snippets` sends none. A failed upload never changes the check's exit code. The GitHub Action gains `token`, `snippets` and `url` inputs to turn it on.

## 0.1.1

No changes in this release.

## 0.1.0

### Minor Changes

- 2ee2e56: Connect repositories to the Groundrule platform: `groundrule login` (browser approval), `whoami`, `logout`, and `init --org`. With `platform:` in the config, `sync` writes your organization's rules at Teach and above, and `check` runs Enforce rules as set and Advise rules as warnings. `GROUNDRULE_TOKEN` works in CI.
- ddf5aef: Add `groundrule scan`: observe a repository against the whole catalog without changing anything. Reports the stack, existing agent instruction files, tool configurations, and how every applicable rule would do today. `--json` prints the report (new `ScanReport` spec kind), `--upload` shares it with your organization, `--no-snippets` leaves code out.
- b4757b4: `groundrule scan` imports what a repository already has as proposals: instructions from agent files (split by heading and list item, de-duplicated, matched to similar catalog rules), linter and compiler settings that enforce catalog rules, and CODEOWNERS entries. `--no-import` leaves them out.
