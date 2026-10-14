# RFC 0008: Signed check runs

- **Status:** Proposed
- **Author:** Groundrule maintainers
- **Spec version:** v1alpha1
- **Builds on:** RFC 0005 (check runs), RFC 0007 (the compliance record)

## Summary
Add an optional `signature` to `CheckRun`, so whoever produced a run can sign it, and anyone with the matching public key can later prove the run wasn't altered: not by the network, not by the service that stores it, and not by anyone who edits a stored copy.

- A **team signs its own CI runs** with a key it generates and keeps in CI. The platform verifies the signature on upload against the public keys the workspace registered, stores the signed document unchanged, and shows who signed it.
- **Groundrule signs the runs it produces** (hosted checks) with its own key, whose public key is published, so those runs are verifiable in the same way.
- Verification needs nothing from Groundrule: `groundrule verify run.json --key team.pub` checks a downloaded run offline.

Signing is optional and additive. Unsigned runs keep working exactly as today.

## Motivation
RFC 0007 made a run a self-contained compliance record: which rules were in effect, each rule's digest, the exceptions used, and the agents declared. An auditor can recompute the rulebook digest, but nothing yet proves that the **run itself** is what the CI job produced. A stored run is a row in a database, editable by whoever operates it; a downloaded run is a JSON file, editable by anyone. A signature closes that gap, and it is the piece RFC 0007 deferred: "signing needs key management".

## Proposal

```yaml
apiVersion: groundrule.dev/v1alpha1
kind: CheckRun
# … every RFC 0005 and RFC 0007 field, unchanged …
signature:                          # optional
  algorithm: ed25519
  keyId: sha256:3f9a…               # the public key's fingerprint (see below)
  value: base64…                    # the Ed25519 signature of the signing payload, 64 bytes
```

### Algorithm
Ed25519 only. It is fast, has small keys and signatures, no parameters to get wrong, and is in Node's `crypto` without dependencies. A future RFC can add an algorithm; receivers reject algorithms they don't know rather than ignore the signature.

### Keys
- A key pair is generated with `groundrule keys generate`. The private key is written as PKCS#8 PEM, the public key as SPKI PEM: the formats Node, OpenSSL and `ssh-keygen` understand.
- **`keyId`** is `sha256:` followed by the SHA-256, in hex, of the public key's raw 32 bytes. It identifies the key in a run and in a workspace's registered keys, and is the same everywhere.
- In CI the private key is a secret, `GROUNDRULE_SIGNING_KEY`, holding the PEM (or its base64, for systems that can't keep multi-line secrets). The CLI never writes the private key anywhere, never uploads it, and never prints it after generation.

### The signing payload
The signature covers the **canonical JSON** (keys sorted at every level, no insignificant whitespace, UTF-8, as in RFC 0007's digests) of the run with two changes:
1. `signature` itself removed;
2. every finding's `snippet` removed.

Snippets are left out on purpose: they are display aids that whoever stores a run may redact again or drop (the Groundrule platform re-redacts them, and drops them for security rules), and a signature must survive that. Everything that makes a run a record (repository, commit, pull request, outcomes, findings with file, line and message, the rulebook digest, exceptions, authorship, metadata) is covered.

A receiver verifies by rebuilding the payload from the run it has and checking the signature against it. A receiver that **stores** a signed run keeps the signed payload byte for byte, so it can hand the exact signed document back later; it can still redact or drop snippets, which the payload doesn't contain.

### Who signs what
| Run | Signer | Key |
|---|---|---|
| CI upload (`groundrule check --upload --sign`) | the team's CI | the team's key, registered in the workspace |
| Hosted check (Groundrule's sandbox) | Groundrule's worker, after the result left the sandbox | Groundrule's key; public key published at a documented address |
| `--write-check-run` with `--sign` | whoever runs the CLI | their key |

A run has at most one signature. The platform doesn't re-sign a team's run; it records whether the team's signature verified.

### Verification on the platform
On upload, when a run carries a signature:
- **The key is registered in the workspace and the signature verifies:** stored as signed and verified, with the key's name.
- **The signature doesn't verify** (the run was altered, or signed with a different key than `keyId` claims): the upload is **rejected** (HTTP 422). A run that claims a signature it doesn't have is worse than an unsigned run.
- **The key isn't registered:** stored, marked "signed with an unregistered key". The team can register the key afterwards; verification is re-run on demand. This keeps a key rotation or a forgotten registration from blocking CI.

Registered keys are public keys only: a name, the PEM, its `keyId`, who added it and when. Removing a key doesn't change stored runs; they keep their status from upload time, and re-verification against the remaining keys is available.

### Verification anywhere else
`groundrule verify <run.json> --key <public.pem>` prints whether the signature matches, the `keyId`, and the run's repository, commit and rulebook digest. Exit code 0 when it verifies, 1 when it doesn't. A downloaded run from the platform is the signed document itself, so this works on it without any Groundrule account.

## Compatibility
Additive within v1alpha1:
- `signature` is optional; the published JSON Schema for `CheckRun` is strict, so receivers with an older schema reject signed runs. The platform updates before the CLI that sends signatures is released, as with RFC 0007.
- Unsigned uploads are unchanged. Nothing in the CLI signs unless `--sign` is given, or `GROUNDRULE_SIGNING_KEY` is set in CI (then `--upload` signs; `--no-sign` turns it off).
- The payload rule (no `signature`, no snippets, canonical JSON) is the only thing a verifier needs, and it is specified here so that other tools can implement it.

## What newly leaves the machine
- The signature (64 bytes) and the key's fingerprint. Never the private key.

## Alternatives considered
- **The platform signs every run on storage.** Easy, but it proves only that the platform didn't alter a run after it stored it, which is what an auditor would want to check independently. A team's own key proves the run came from the team's CI. Both are kept: teams sign CI runs, Groundrule signs the runs it produces.
- **Signing the whole document, snippets included.** The platform re-redacts snippets on storage, which would break every signature, or force the platform to keep unredacted snippets, which it must not. Excluding snippets keeps the security guarantee and the signature.
- **Sigstore / keyless signing.** Attractive for GitHub Actions (OIDC identity, no secret), but it adds a transparency-log dependency and doesn't cover other CI systems or hosted checks. It can be added later as a second algorithm; the payload rule stays the same.
- **JWS / detached JWS envelopes.** More machinery (headers, encodings) for no gain over one field with three values.

## Decisions to make
1. **Default in CI:** sign automatically when `GROUNDRULE_SIGNING_KEY` is set (recommended; `--no-sign` opts out), or only with an explicit `--sign`.
2. **Unregistered key:** accept and mark (recommended), or reject.
3. **Groundrule's own key:** one key for the service, with its public key published on the docs site and at `https://api.groundrule.dev/.well-known/groundrule-keys.json` (recommended), rotated by publishing the new key alongside the old.
