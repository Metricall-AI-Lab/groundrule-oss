# ADR 0007: Coding agents check their own work

- **Status:** Accepted
- **Date:** 2026-10-12

## Context

Agents learn the rules from `AGENTS.md` and the other agent files (`groundrule sync`) and from `list_standards` (ADR 0006). They find out they broke one only when CI fails, after the pull request is open. The agent files already ask them to run `npx @groundrule/cli check` before finishing, but nothing makes sure they do, and the terminal report is written for people.

Claude Code, Codex, and Cursor each run a project-level command when the agent is about to finish its turn. Claude Code and Codex can stop the agent from finishing and give it a reason (`{"decision":"block","reason":…}`); Cursor can send a follow-up message (`followup_message`).

## Decision

- **An MCP `check` tool.** It runs the same checks as `groundrule check`, on uncommitted changes by default, or since a `base` ref, or on every file. It is read-only and uploads nothing. The report is written for an agent: only findings the change introduced (no legacy or suppressed ones), blocking first, each with standard, location, message, and the fix, at most 30 listed. A `base` must look like a git ref and can't start with `-`, so an agent can't pass git options.
- **`groundrule hooks` installs a stop hook** in `.claude/settings.json`, `.codex/hooks.json`, or `.cursor/hooks.json`, keeping everything else in those files. By default it installs for Claude Code and for the other agents whose folder the repository already has. The hook runs `npx --yes @groundrule/cli hook <agent>`, with a 120-second timeout. `--remove` takes out only Groundrule's hook.
- **`groundrule hook <agent>` (hidden)** is what the hook runs. When the check fails it blocks the stop with the report (Claude Code, Codex) or sends it as a follow-up (Cursor). It asks once per turn: when the agent is already continuing because of the hook (`stop_hook_active`, or Cursor's `loop_limit: 1`), it lets the agent finish. It never fails the agent: a missing configuration or a git error is printed on stderr, and the agent finishes normally.
- **Copilot is left out for now.** Its hook format is documented, but we haven't verified the exact event payload yet.
- **No spec change.** Hooks are installed by a command, not configured in `.groundrule/config.yaml`.

## Consequences

- Most blocking findings are fixed in the agent's own session, before a commit, and CI becomes the backstop rather than the first signal.
- Every finish runs the checks once more. Changes-mode checks take well under a second on typical changes, plus `npx` start-up.
- An agent can still finish with a finding it can't fix; CI and the required Groundrule check on the pull request still catch it.
- Adding another agent means adding its file and output shape to `hooks.ts`.
