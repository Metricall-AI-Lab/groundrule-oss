---
"@groundrule/spec": minor
"@groundrule/core": minor
"@groundrule/cli": minor
---

Check runs are now a compliance record (RFC 0007). An uploaded run says which rules were in effect, as a `rulebook` digest anyone with the same rules can recompute; each rule's `version`, `digest`, rollout `stage` and `enforcement` (checked, AI review or guidance); the `exceptions` that suppressed findings, with who approved them and when they expire; and `authorship`: the coding agents the change's commits declare (Claude Code, Cursor, GitHub Copilot coding agent, Codex, Aider), as counts, from commit trailers and bot authors only. `--no-authorship` leaves the agent counts out. All fields are optional, so older runs stay valid.
