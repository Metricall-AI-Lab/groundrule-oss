# RFC 0005: Check runs

- **Status:** Accepted
- **Author:** Groundrule maintainers
- **Spec version:** v1alpha1

## Summary
Add `CheckRun`, the result of one `groundrule check`, shaped so a service can receive it from CI: which repository, commit and pull request it was for, whether it passed, how every standard came out, and a bounded list of findings. `groundrule check --upload` sends it. It lives in the spec and has a JSON Schema (`check-run.schema.json`) so the CLI and any receiving service agree on one contract.

## Motivation
Checks run in CI today, and their results stay in the CI log. A team can't see, across repositories, which pull requests failed, which rules block most often, or whether a newly enforced rule is noisy. The existing `--format json` output carries no repository, commit or pull-request identity and has no schema, so it can't serve as that contract. As with scans (RFC 0003), the format must be explicit about what leaves the machine, so security teams can review it.

## Proposal
```yaml
apiVersion: groundrule.dev/v1alpha1
kind: CheckRun
metadata: { generatedAt: 2026-10-12T10:00:00Z, cliVersion: 0.2.0, durationMs: 420, snippets: true }
repository: { name: acme/payments-api, commit: <40 hex>, branch: fix/refunds }
pullRequest:            # present when run for a pull request (from the CI provider's event data)
  number: 42
  title: Add refunds
  url: https://github.com/acme/payments-api/pull/42
  headRef: fix/refunds
  headSha: <40 hex>       # the pull request's head commit (added in 0.3.0)
  baseRef: main
  author: octocat
mode: changes           # all | changes
base: 3f2c…             # the ref compared against, in changes mode
files: 812              # files checked
changedFiles: 4
passed: false
failOn: blocker         # blocker | warning | none
summary: { standards: 83, passed: 43, failed: 1, warned: 2, notEvaluable: 0, guidance: 1, skipped: 36,
           violations: 4, concerns: 0, suppressed: 0, legacy: 0, blocking: 1 }
outcomes:               # one per standard that applied
  - { id: ACME-001, title: Represent money as integer cents, severity: blocker, status: failed, violations: 1, concerns: 0 }
findings:               # at most 500, blocking first
  - standardId: ACME-001
    severity: blocker
    status: violation
    source: deterministic
    blocking: true
    isNew: true
    file: src/refunds.ts
    line: 6
    message: Money handled as a float; use integer cents
    snippet: 'const total = amount * 1.0;'
omittedFindings: 0      # findings beyond the 500 sent
```
- `outcomes` excludes standards that were skipped as out of scope, so its size follows what actually applied (at most 2000).
- Findings are the violations and concerns of the run, blocking first, then by severity, file and line; at most 500, with `omittedFindings` counting the rest. Passing results are not findings.
- Snippets are one line, at most 200 characters, with credential-shaped values replaced by `[redacted]`. Standards in the `security` category never include snippets. `metadata.snippets: false` (`--no-snippets`) omits all of them. Messages are at most 300 characters.
- `pullRequest` comes from the CI provider (GitHub Actions: the `pull_request` event payload). Outside a pull request it is omitted, and the run describes the branch or commit.
- `pullRequest.headSha` (optional, added in 0.3.0) is the pull request's head commit. CI usually checks out a test merge commit, which is `repository.commit`; a service that shows results on the pull request needs the head. Receivers must accept runs without it.
- Nothing else leaves the machine: no file contents, no diffs, no environment.

## Compatibility
Additive: a new document kind. It is not a configuration document and is never loaded from a repository. `--format json` keeps its current shape.

## Alternatives considered
- Upload SARIF: it describes findings but not the run (mode, base, pass/fail threshold, per-standard outcomes, pull-request identity), and encourages unbounded result lists.
- Extend `--format json`: changing its shape would break scripts that read it today, and it was never meant to carry identity.
