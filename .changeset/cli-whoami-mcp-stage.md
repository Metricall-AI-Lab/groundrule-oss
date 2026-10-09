---
"@groundrule/cli": patch
---

`groundrule whoami` now finds logins made with `login --url` from any folder, and an empty `GROUNDRULE_URL` counts as unset. The MCP `list_standards` tool shows each organization rule's rollout stage, so agents know which findings only warn.
