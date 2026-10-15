---
"@groundrule/cli": minor
---

Just-in-time rules (ADR 0010): the MCP tool `rules_for` returns the standards that name the files an agent is about to change, blocking first; `groundrule hooks` also gives Claude Code a before-edit hook that adds those rules to each edit, once per file per session. Rules that apply everywhere stay in the agent file and aren't repeated.
