---
"@groundrule/spec": minor
"@groundrule/core": minor
"@groundrule/cli": minor
---

Keyless signing with Sigstore (RFC 0009). In GitHub Actions, `groundrule check --upload --sigstore` (or the Action's `sigstore: "true"`, with `permissions: id-token: write`) signs the result with the job's own identity: no private key anywhere, and the signature names the repository and workflow that produced the run. `groundrule verify` checks such a run without `--key`, against Sigstore's trust root, and requires the signer to be a workflow of the run's repository. Opt-in only: the workflow identity and the result's hash go to Sigstore's public log. `signature.algorithm` is now `ed25519` or `sigstore`.
