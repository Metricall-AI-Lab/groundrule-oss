# RFC 0006: Agent sync reports

- **Status:** Accepted
- **Author:** Groundrule maintainers
- **Spec version:** v1alpha1

## Summary
Add `AgentSync`, a report of what one repository delivers to coding agents. It covers:
- which agent files the config asks for, and whether each matches the rulebook;
- which rules those files carry;
- whether the repository has Groundrule's stop hooks (ADR 0007) and MCP server set up.

`groundrule sync --upload` sends it, after writing or with `--check`. The GitHub Action sends it whenever it has a token. A JSON Schema (`agent-sync.schema.json`) gives the CLI and a receiving service one contract.

## Motivation
A team can't see, across repositories, whether their rules actually reach coding agents:
- which repositories write `AGENTS.md`, `CLAUDE.md`, Cursor rules or Copilot instructions;
- which of those files fell behind the rulebook;
- where agents check their own work before finishing.

`sync --check` already knows the answer for one repository, but it only shows it in a CI log. As with scans (RFC 0003) and check runs (RFC 0005), the format must be explicit about what leaves the machine.

## Proposal
```yaml
apiVersion: groundrule.dev/v1alpha1
kind: AgentSync
metadata: { generatedAt: 2026-10-12T10:00:00Z, cliVersion: 0.5.0 }
repository: { name: acme/payments-api, commit: <40 hex>, branch: main }
pullRequest: { number: 42, ... }   # as in CheckRun, when sent from CI for a pull request
rulebook: platform                  # platform | local
upToDate: false
targets:                            # the formats the config asks for
  - target: agents-md
    files: [{ path: AGENTS.md, status: current }]
  - target: cursor
    files:
      - { path: .cursor/rules/groundrule.mdc, status: outdated }
      - { path: .cursor/rules/groundrule-api.mdc, status: leftover }
standards: { delivered: 38, ids: [SEC-001, SEC-002, ...] }
hooks:                              # Groundrule's stop hook in project settings (ADR 0007)
  - { agent: claude-code, installed: true }
  - { agent: codex, installed: false }
  - { agent: cursor, installed: false }
mcp:                                # project MCP settings that start `groundrule mcp`
  - { client: claude-code, configured: true }   # .mcp.json
  - { client: cursor, configured: false }       # .cursor/mcp.json
  - { client: vscode, configured: false }       # .vscode/mcp.json
```
- **File statuses:**
  - `current`: the file matches.
  - `outdated`: it exists but differs.
  - `missing`: it should exist.
  - `leftover`: Groundrule generated it earlier and it should now be removed.

  After `sync` writes the files, every status is `current`.
- **`standards.ids`** lists the rules written into the agent files, in order, at most 2000.
- **`hooks` and `mcp`** only report what the repository's own project files say. Settings in a developer's own profile can't be seen, so `false` means "not set up in the repository", not "not used".
- **Nothing else leaves the machine:** no file contents, no environment, nothing from the developer's own settings.

## Compatibility
Additive: a new document kind. It is not a configuration document and is never loaded from a repository. `sync` without `--upload` behaves as before, and `sync --check` keeps its exit code whatever happens to the upload.

## Alternatives considered
- **Extend `CheckRun`.** Check runs describe code changes and come from pull requests. Agent delivery is a property of the repository. Mixing them would make every check run carry agent data and make "latest state of a repository" harder to read.
- **Derive it on the service from scans.** Scans (RFC 0003) see agent files but not whether they match the rulebook, because that needs the rulebook as the CLI resolves it, with overrides and scopes.
