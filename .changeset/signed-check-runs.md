---
"@groundrule/spec": minor
"@groundrule/core": minor
"@groundrule/cli": minor
---

Signed check runs (RFC 0008). `groundrule keys generate` creates an Ed25519 key pair; with the private key in `GROUNDRULE_SIGNING_KEY`, `check --upload` and `--write-check-run` sign each result (`--no-sign` opts out, `--sign` insists). `groundrule verify run.json --key public.pem` checks a run offline and exits 1 if it was altered. The signature covers the whole run except code snippets, so a receiver may redact them without breaking it. `signature` is optional on `CheckRun`; unsigned runs are unchanged.
