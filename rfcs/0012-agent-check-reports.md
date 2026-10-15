# RFC 0012: Agent check reports

- **Status:** Accepted (16 October 2026)
- **Author:** Groundrule maintainers
- **Spec version:** v1alpha1

## Summary
When the stop hook or the MCP `check` tool runs in a repository connected to the platform, the CLI sends a small `AgentCheck` document: which rules found what, how many, and whether the agent was stopped. Counts only; never a file name, a line, a snippet or a prompt. The platform aggregates these with pull-request runs (RFC 0005) and scans (RFC 0003) into one view: how many violations were flagged in the agent loop before a commit existed, how many on pull requests, and how many reached the default branch.

## Motivation
Groundrule is the only tool that sits in both the agent loop and CI, and it has no evidence of the first. Hook and MCP checks run locally and are forgotten, so a team that adopted a rule cannot see whether agents now follow it, and a buyer cannot see what the product does before review. The report is the smallest document that answers both: per rule, how often agents were told, and whether that number falls over time.

## Proposal
```yaml
apiVersion: groundrule.dev/v1alpha1
kind: AgentCheck
metadata:
  generatedAt: 2026-10-16T09:12:04Z
  cliVersion: 0.16.0
repository:
  name: acme/payments-api          # platform.repository, else the git remote
agent:
  name: claude-code                # hook: the agent whose hook ran; mcp: the client's name, lower-cased
  via: hook                        # hook | mcp
  client: { name: Claude Code, version: 2.1.0 }   # MCP clients only, as they introduce themselves
  session: 3f1c…                   # optional: sha256 of the agent's session id, when it gives one
check:
  mode: changes                    # changes | all
  base: origin/main                # when the check compared against a ref
  files: 12                        # files checked
  standards: 41                    # rules evaluated
  durationMs: 840
findings:                          # rules that found something; empty when the check passed
  - id: SEC-006
    severity: blocker
    count: 2
    blocking: true                 # counted toward the agent being stopped
  - id: TS-001
    severity: warning
    count: 1
    blocking: false
stopped: true                      # the hook returned "block", or the tool reported a failure
```

**When it is sent.** After every hook run and every MCP `check` call, when the repository's config has `platform:` and this computer is signed in to that workspace (`groundrule login`, or a token in `GROUNDRULE_TOKEN`). Otherwise never: an offline repository stays offline. `platform.reports: none` in the config turns it off for a connected repository; `groundrule doctor` says which applies.

**How it is sent.** `POST /v1/cli/agent-checks` with the token, after the check's own result has been delivered to the agent, with a two-second timeout, and every failure ignored. A report can never slow the agent down, block a turn, or change the check's result.

**What it never contains.** Paths, line numbers, snippets, diffs, the agent's prompt or output, the developer's name. The repository name is the one the workspace already knows. `session` is a hash so repeated checks in one agent turn can be counted once; the platform cannot recover the id.

**Counting (platform).** "Flagged in the agent loop" for a rule in a period is the sum, over sessions, of the largest `count` the rule had in that session; without a session each report is its own session. So a finding reported on three successive turns until the agent fixed it counts once, and the fix itself is what makes the next turn's count zero. "Flagged on pull requests" comes from `mode: changes` check runs with a pull request; "reached main" from the latest scan or full run of each repository's default branch. The three are separate populations and are never added together.

## Compatibility
Additive: a new document kind, a new optional `platform.reports` field in the config, a new endpoint. The MCP `check` tool's description changes from "Nothing is uploaded" to the sentence above. Older CLIs send nothing; older platforms answer 404, which the CLI ignores.

## Alternatives considered
- **Opt-in per repository.** Rejected: a connected repository already uploads scans and check runs with paths and snippets; a count per rule is less than that, and the dashboard is only true for workspaces that send it. The off switch and the exact payload are documented instead.
- **Sending the full check run (RFC 0005).** Rejected: hooks run on every agent turn, on uncommitted code, and paths and snippets from that moment aren't something a developer expects to leave the machine.
- **Matching agent-loop findings to later CI findings to claim "prevented".** Rejected: the match is unreliable across rewrites, and a number that can't be defended is worse than three that can.
- **Reporting from the hosted MCP server only.** Rejected: most agent checks run through the local hook, which the hosted server never sees.
