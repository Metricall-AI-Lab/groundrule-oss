# @groundrule/spec

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
