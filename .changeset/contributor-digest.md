---
"@groundrule/spec": minor
"@groundrule/cli": minor
---

The contributor digest on uploads (RFC 0014): `check --upload` and `scan --upload` send one salted SHA-256 hash per distinct commit author in the last 90 days, so the workspace counts active contributors exactly, without any address. `--no-contributors` leaves it out.
