# ADR 0010: Just-in-time rules for coding agents

- **Status:** Accepted (the before-edit hook is now part of the before-tool hook, RFC 0017)
- **Date:** 16 October 2026

## Context

Agents read the whole rulebook once, from `AGENTS.md` or `list_standards`, and then write code for an hour. Rules scoped to particular paths or languages ("migrations must be reversible", "payment code never logs amounts") are the ones that matter most at the moment a file is touched, and the ones most likely to have scrolled out of the agent's attention by then. Rulebooks also grow: fifty rules in every prompt is a cost, and most of them don't apply to the file being edited.

What agents can take at the moment of an edit differs. Claude Code's `PreToolUse` hook sees the file about to be written and can add context to the tool call (`hookSpecificOutput.additionalContext`). Cursor's file hooks see the path but return no context. Codex and Copilot document a `preToolUse` hook without a context channel. Every agent with MCP can call a tool.

## Decision

**One universal mechanism and one native one, both answering the same question: which rules apply to these files?**

1. **MCP tool `rules_for`**, in `groundrule mcp` and in the hosted server. Input: `files` (repository-relative paths the agent is about to change). Output: the rules whose scope matches those files, as paths, excludes and the file's language, blocking first, one line each with the fix hint and "checked automatically" where a deterministic check runs at the rule's stage. Rules with no scope are not repeated: they are already in the agent file, and the answer says how many there are. At most 25 rules; beyond that the answer says how many more and points at `list_standards`. The server's instructions tell the agent to call it before editing a file.
2. **A before-edit hook for Claude Code.** `groundrule hooks` installs, next to the stop hook, a `PreToolUse` hook matching `Edit|Write|MultiEdit` that runs `groundrule hook claude-code --before-edit`. It reads `tool_input.file_path`, and answers with `additionalContext` holding the same text `rules_for` would give for that file. Once per file per session, keyed by the hook's `session_id` in the OS temporary directory, so a file edited ten times is explained once. Nothing when no scoped rule applies. It never blocks an edit, and it reads only the rulebook the CLI already reads.
3. **Measured, not asserted.** No new data is collected. The "where violations are stopped" view (platform ADR 0030) is how a team sees whether just-in-time delivery lowers what agents are told after the fact.

## Consequences

- No change to the document format or to `AGENTS.md`: the agent file still carries every rule the way it did; this delivers the scoped ones again at the right moment.
- Cursor, Codex and Copilot get the tool, not the hook, until they expose a context channel before edits; the docs say so plainly rather than promising a hook that can't deliver.
- The hook's cache lives outside the repository and is keyed by session, so it never leaks between developers or into commits; a missing or unwritable temp dir means the rules are simply repeated.
