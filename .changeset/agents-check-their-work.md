---
"@groundrule/cli": minor
---

Coding agents check their own work. `groundrule mcp` adds a `check` tool: the same check CI runs, on the agent's uncommitted changes (or since a ref, or every file), reporting only what the change introduced and how to fix it. `groundrule hooks` adds a stop hook for Claude Code, Codex, and Cursor, so the agent runs the check whenever it finishes a task and is told what to fix.
