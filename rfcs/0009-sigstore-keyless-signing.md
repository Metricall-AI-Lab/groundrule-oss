# RFC 0009: Keyless signing with Sigstore

- **Status:** Accepted (14 October 2026)
- **Author:** Groundrule maintainers
- **Spec version:** v1alpha1
- **Builds on:** RFC 0008 (signed check runs)

## Summary
A second way to sign a check run, with no private key anywhere: in GitHub Actions, the job proves its identity with the short-lived token GitHub issues to it, Sigstore turns that identity into a certificate valid for minutes, the job signs the run with it, and the signature is recorded in Sigstore's public transparency log. A verifier learns not just *which key* signed the run but *which workflow of which repository* did, and the platform needs no registered key to trust it.

```yaml
signature:
  algorithm: sigstore
  bundle: { … }                       # a Sigstore bundle (certificate, signature, log entry)
  identity:
    issuer: https://token.actions.githubusercontent.com
    subject: https://github.com/acme/payments/.github/workflows/groundrule.yml@refs/heads/main
```

The RFC 0008 signing payload is unchanged. Key-based signing stays; a run has one signature of either kind.

## Motivation
RFC 0008 proves a run wasn't altered, but trusting it means trusting a key: the team keeps a private key in CI and registers the public key. Keys leak, rotate, and get forgotten. Every GitHub Actions job can already prove its identity to outside services (OIDC); Sigstore (used by npm, PyPI and Kubernetes for the same purpose) makes that identity sign things without a long-lived key. For an auditor, "signed by `acme/payments`' `groundrule.yml` workflow on GitHub" is a stronger statement than "signed by key sha256:…", because it names the origin.

## Proposal

### Format
`signature` becomes one of two shapes, told apart by `algorithm`:
- `ed25519` (RFC 0008): `keyId`, `value`.
- `sigstore`: `bundle`, the Sigstore bundle as JSON (media type `application/vnd.dev.sigstore.bundle.v0.3+json` or later): the short-lived certificate, the signature over the RFC 0008 payload, and the transparency-log entry with its inclusion proof; and `identity`, the certificate's `issuer` and `subject`, copied out at signing time so readers don't have to parse the certificate. Verifiers derive the identity from the certificate and must find the same values.

### Signing
`groundrule check --upload --sigstore` (and `--write-check-run … --sigstore`): the CLI builds the RFC 0008 payload, asks Sigstore to sign it with the job's identity (GitHub Actions needs `permissions: id-token: write`), and records the bundle. The GitHub Action exposes it as `sigstore: "true"`.

It is **opt-in** and never automatic: signing publishes the workflow identity and the payload's hash (never the payload) in Sigstore's public log, and a team must choose that. Outside a supported CI, `--sigstore` stops with an explanation.

### Verification and policy
A verifier checks the bundle against Sigstore's public trust root (the certificate chain, the log entry's inclusion proof, the signature over the payload), then applies a policy:
- the issuer must be GitHub Actions (`https://token.actions.githubusercontent.com`);
- the subject must be a workflow of the run's own repository: it starts with `https://github.com/<repository.name>/`.

So a workflow in another repository can't sign a run that claims to be this repository's. Other issuers (GitLab CI, Google Cloud Build) can be added later as policies; receivers reject issuers they don't know.

### On the platform
A Sigstore-signed upload is verified on arrival. It passes: stored `verified`, with the identity shown as "Signed by GitHub Actions: `acme/payments` · `groundrule.yml` on `refs/heads/main`". It fails verification or the policy: refused, like a bad key signature. Nothing is registered; the workspace's signing keys are untouched.

`groundrule verify run.json` on a Sigstore-signed run needs no `--key`: it verifies against the public trust root and applies the same policy, and prints the identity.

### Trust root
Sigstore's trust root (the Fulcio and Rekor keys) is distributed by TUF and embedded in the client library, which refreshes it. Verification therefore works offline with the embedded root and online with the latest.

## Compatibility
Additive within v1alpha1: `signature.algorithm` was a literal `ed25519` and becomes a union; `ed25519` runs are unchanged. Receivers with the older schema reject `sigstore` runs; the platform updates before the CLI that produces them is released, as before.

## What newly leaves the machine
- To Sigstore's services: the job's OIDC identity token (to Fulcio, which issues the certificate) and the signature with the payload's SHA-256 (to Rekor's public log). Never the payload itself, never code.
- In the run: the bundle (certificate, signature, log entry) and the identity.

## Alternatives considered
- **Automatic when the token is available.** Rejected: publishing to a public log must be a choice.
- **Storing only the certificate and signature, without the log entry.** Rejected: the inclusion proof is what makes verification possible after the certificate's ten minutes expire.
- **Our own identity-bound certificates.** Rejected: it would make Groundrule a certificate authority; Sigstore exists for this.

## Decisions (14 October 2026)
1. **Opt-in only** (`--sigstore`, `sigstore: "true"`), never automatic.
2. **GitHub Actions first**; the policy ties the identity to the run's repository.
3. **No registration**: a verified Sigstore signature is trusted by its identity, not by a key the workspace listed.
