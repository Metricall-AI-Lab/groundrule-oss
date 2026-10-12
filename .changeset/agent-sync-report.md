---
"@groundrule/spec": minor
"@groundrule/cli": minor
---

`groundrule sync --upload` reports what a repository delivers to coding agents (RFC 0006): which agent files the config asks for and whether they match the rulebook, which rules they carry, and whether Groundrule's stop hooks and MCP server are set up in the repository. Paths, rule IDs and yes/no only. The GitHub Action sends it whenever it has a token. New spec kind: `AgentSync`.
