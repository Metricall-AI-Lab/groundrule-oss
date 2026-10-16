---
"@groundrule/cli": patch
---

`groundrule whoami` no longer fails outright when one saved login points at a host that doesn't answer (an old local test server, say). It lists that login as unreachable with the `logout --url` command that removes it, and still shows the others. Naming the host with `--url` or `GROUNDRULE_URL` keeps the error.
