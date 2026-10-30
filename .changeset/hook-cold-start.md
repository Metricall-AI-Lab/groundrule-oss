---
"@groundrule/cli": patch
---

The before-tool hook no longer lets the first tool call through on a cold start. `groundrule hooks` pins the exact CLI version in the hook command (npx serves it from its cache instead of resolving a range against the registry on every call), warms that cache when it installs, and gives the hook 30 seconds instead of 10, since a timed-out hook does not block the call. For Claude Code and Codex the hook now matches only the tools a policy can decide (shell, edits, reads, fetches and MCP calls), so search and navigation tools are never slowed. Run `groundrule hooks` again to update installed hooks.
