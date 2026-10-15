---
"@groundrule/spec": minor
"@groundrule/cli": minor
---

Agent check reports (RFC 0012): in a repository connected to its workspace, the stop hook and the MCP `check` tool send the counts per rule they found (agent, mode, files, rules, whether the agent was stopped) to `POST /v1/cli/agent-checks`, after the agent has its answer and never slowing it down. Never a path, a line or code. `platform.reports: none` turns it off; `groundrule doctor` says which applies. New document kind `AgentCheck`.
