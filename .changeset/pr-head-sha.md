---
"@groundrule/spec": minor
"@groundrule/cli": minor
---

`check --upload` now sends the pull request's head commit (`pullRequest.headSha`, read from GitHub's event data), so a service that posts the result on the pull request attaches it to exactly the commit that was checked, even if someone pushed again while CI was running. Additive and optional in the `CheckRun` format (RFC 0005).
