---
"@groundrule/spec": minor
"@groundrule/core": minor
"@groundrule/cli": minor
"@groundrule/adapters": minor
"@groundrule/packs": minor
---

Action policies (RFC 0017): a second policy kind, `ActionPolicy`, says what a coding agent may do on its own, what needs a person, and what is refused. `groundrule hooks` now installs a before-tool hook for Claude Code, Codex, Cursor and Copilot that decides shell commands, edits, reads, fetches and MCP calls against the policies in effect (`allow`, `ask`, `deny`; default `ask`), with exceptions and rollout stages applying as they do for standards. The rules for a file before an edit (ADR 0010) ride along in the same answer. A new pack, `groundrule:packs/agent-actions`, ships ten policies (force-pushes, history rewrites, hook bypass, piping downloads into a shell, publishing, infrastructure changes, elevated privileges, deleting outside the repository, secret files, CI workflows). Agent files gain a section "What you may not do alone". In a connected repository, `ask` and `deny` decisions are reported to the workspace as counts and policy ids, never the command or path.
