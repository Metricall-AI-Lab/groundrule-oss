# RFC 0014: The contributor digest on uploads

- **Status:** Accepted (27 October 2026)
- **Author:** Groundrule maintainers
- **Spec version:** v1alpha1

## Summary
`groundrule check --upload` and `groundrule scan --upload` may carry a **contributor digest**: one SHA-256 hash per distinct commit author in the repository's last 90 days, salted with a value the workspace hands out. The workspace counts distinct hashes across its repositories and that count is its number of active contributors, the only thing the hosted platform bills per. Nobody can read an address back from a hash; the CLI sends no names, emails or commits. `--no-contributors` leaves the digest out.

## Motivation
The platform's price is per active contributor: anyone who committed to a connected repository in the last 90 days. Until now the platform estimated that number from pull-request authors on uploaded check results, which undercounts (not every commit is a pull request) and is labelled "estimated" on the billing page. An invoice should rest on a number both sides can reproduce from the repository itself.

Sending author emails would make the platform a store of personal data it has no use for. A salted hash is enough to count distinct people and to recognise the same person across repositories of one workspace, and is useless outside it.

## Proposal

### The digest
```json
"contributors": {
  "since": "2026-07-29T00:00:00Z",
  "complete": true,
  "digests": ["3f9a…", "b02c…"]
}
```

| Field | Meaning |
|---|---|
| `since` | Start of the window: 90 days before the run. |
| `complete` | `false` when the repository is a shallow clone, so history may be missing. The workspace still records what was sent. |
| `digests` | SHA-256 over `"<salt>:" + lowercased, trimmed author email`, hex, one per distinct author. At most 5,000. |

The field is optional on `CheckRun` (RFC 0005) and `ScanReport` (RFC 0003). Older CLIs omit it; older platforms ignore it.

### The salt
`GET /v1/cli/contributors/salt` (any token with `rulebook:read`) returns `{ "salt": "<32 random bytes, hex>" }`, created on first request and fixed for the workspace from then on. The same person hashes the same way in every repository of that workspace, and differently in any other workspace. The salt never leaves the workspace's API and the CLI never writes it to disk.

### What the CLI does
Before an upload, unless `--no-contributors`:

1. Fetch the salt. If the platform does not offer one (an older platform, or an error), upload without the digest.
2. `git log --since=90.days --format=%ae <ref>`, where `<ref>` is `origin/HEAD` when it resolves (the default branch) and `HEAD` otherwise. Addresses ending in `[bot]@users.noreply.github.com` are dropped.
3. Hash each distinct address with the salt; `complete` is `false` when `git rev-parse --is-shallow-repository` says `true`.

Everything runs locally, with the git the repository already has. A failure at any step drops the digest and never fails the upload or the check.

### What the platform does
For each digest it stores `(workspace, repository, hash, first seen, last seen)` and counts distinct hashes with `last seen` inside 90 days. Once any digest exists, the count is exact and the "estimated" label goes; the per-repository breakdown comes from the same rows. Rows stop counting on their own when they age out of the window.

## Privacy
- No email, name, login or commit identifier is sent. A hash cannot be reversed; without the salt it cannot even be matched against a guess.
- The salt is per workspace, so hashes from different workspaces cannot be joined.
- A repository is counted only when its own CI or a developer uploads with `--upload`; nothing is read from the code host.
- `--no-contributors` turns the digest off; the workspace then keeps the estimate for that repository.

## Alternatives considered
- **Counting from the code host's API.** Needs a broad permission the GitHub App does not ask for, and does not work for repositories without the app.
- **Unsalted hashes.** Reversible for common addresses by guessing; rejected.
- **Names from `git shortlog`.** Personal data for nothing the count needs.

## Compatibility
Additive. CLI 0.20.0 sends the digest; the platform ignored unknown fields before and accepts this one from the same release. `--no-contributors` is new on `check` and `scan`.
