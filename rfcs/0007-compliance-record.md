# RFC 0007: Compliance record on check runs

- **Status:** Accepted (14 October 2026)
- **Author:** Groundrule maintainers
- **Spec version:** v1alpha1

## Summary
Add four optional fields to `CheckRun` (RFC 0005) so a check run can prove which rules were applied to a change and how:

- **`rulebook`**: a digest of every rule in effect, so two runs can be shown to have used exactly the same rules;
- **per-outcome `version`, `digest`, `stage` and `enforcement`**: what each rule said, at which rollout stage, and whether it could fail the change;
- **`exceptions`**: the exceptions that suppressed findings in this run, with who approved them and when they expire;
- **`authorship`**: which coding agents the change's commits declare, as counts.

All four are additive and optional. Older runs and older receivers keep working.

## Motivation
AI now writes most new code in many teams, and their standards are increasingly a compliance question. An auditor or a customer's security reviewer asks: *"Which rules applied to this change, did it meet them, and who wrote it?"* A `CheckRun` today answers only part of that:

- It has each rule's ID, severity and result, but not **which version** of the rule, so a rule edited after the run makes the record ambiguous.
- It doesn't say **at which stage** the rule ran. A rule at Teach doesn't run its checks, at Advise it only warns, and at Enforce it fails the run, so the same "passed" means different things.
- It doesn't say whether a rule **could fail the change** at all (the label added in CLI 0.8.0: checked, AI review or guidance).
- Exceptions suppress findings (`summary.suppressed` counts them), but the run doesn't say **which** exception, or who approved it.
- Nothing records **who or what** wrote the change. Compliance per coding agent ("Claude Code meets 94% of your rules") is the measure teams ask for.

With these fields, a run is a self-contained compliance record. A service can store it, report on it, and later sign it, without trusting anything that isn't in the run.

## Proposal

```yaml
apiVersion: groundrule.dev/v1alpha1
kind: CheckRun
# … every RFC 0005 field, unchanged …
rulebook:                       # optional
  digest: sha256:9f2c…          # see "Digests" below
  standards: 83                 # rules in effect (same set as the digest)
  source: platform              # platform | local
  platform:                     # when source is platform
    org: acme
    generatedAt: 2026-10-14T09:00:00Z
outcomes:
  - id: ACME-001
    title: Represent money as integer cents
    severity: blocker
    status: failed
    violations: 1
    concerns: 0
    version: 3                  # optional: the standard's metadata.version
    digest: sha256:41ab…        # optional: the rule as applied (see "Digests")
    stage: enforce              # optional: observe | teach | advise | enforce; platform rules only
    enforcement: checked        # optional: checked | ai-review | guidance (enforcementOf, 0.8.0)
exceptions:                     # optional: only exceptions that suppressed a finding in this run
  - id: EX-1042
    standard: ACME-001
    expires: 2026-12-31
    approvedBy: priya           # as written in .groundrule/exceptions.yaml; omitted when absent
    suppressed: 2               # findings it suppressed in this run
authorship:                     # optional: only in changes mode, and only when the commits are known
  commits: 7                    # commits in the change
  agents:                       # coding agents the commits declare, most commits first
    - { name: Claude Code, commits: 5 }
    - { name: Cursor, commits: 1 }
  method: commit-metadata       # how agents were detected (see below)
```

### Digests
- **A rule's `digest`** is `sha256:` followed by the SHA-256, in hex, of the rule **as applied**: the standard document after organization, team and repository customizations, serialized as canonical JSON (keys sorted, no insignificant whitespace, UTF-8). A rule whose wording, checks, severity or scope changed gets a new digest even when its `version` wasn't bumped.
- **The `rulebook.digest`** is `sha256:` followed by the SHA-256 of the lines `<id> <digest> <stage or "-"> <severity>`, one per rule in effect, sorted by ID, joined with `\n`. Anyone with the same rules can recompute it; any change to any rule, or to a stage or severity, changes it.
- "In effect" is every active rule the repository received and no override turned off, at every stage except Observe (Teach rules are in effect for agents even though their checks don't run). Whether a rule applies to this repository's languages isn't part of it, so adding a file in a new language doesn't change the rulebook digest.

### Exceptions
- Listed only when they suppressed at least one finding in this run, at most 200.
- `reason` and `remediation` aren't included: they are free text from the repository and can be long. The ID points to them.
- `approvedBy` is copied as written. Repositories that don't want approver names to leave the machine can omit the field from their exceptions file.

### Authorship
- Counted over the commits in the change: in CI, `base..HEAD`; in a hosted check, the pull request's commits.
- **Agents are detected from commit metadata only**, never from the code. Known markers:
  - `Co-Authored-By:` trailers naming an agent, e.g. `Claude <noreply@anthropic.com>`, `Cursor <cursoragent@cursor.com>`, `Codex`, `aider`;
  - commits authored by an agent's bot account, e.g. GitHub's Copilot coding agent.

  The list of markers lives in the CLI and grows over time; `method: commit-metadata` says how the counts were made.
- **This is a declaration, not proof.** A developer can remove a trailer, and an agent can be used without one. Reports must label it "as declared in commits".
- **Only counts leave the machine**: no commit messages, SHAs, author names or emails. Commits without an agent marker are counted in `commits` and attributed to no one.
- Omitted in `all` mode, and when git history isn't available (e.g. shallow clones without the base).

### Limits
- `exceptions`: at most 200 entries.
- `authorship.agents`: at most 20 entries; `name` at most 60 characters.
- Digests: exactly `sha256:` plus 64 lowercase hex characters.

## Compatibility
Additive within v1alpha1. Every new field is optional:
- **Older CLIs** send runs without them; receivers treat those runs as "no compliance record" and show what they have.
- **Older receivers** using the published JSON Schema would reject unknown fields, because `CheckRun` is a strict object. The Groundrule platform is updated before the CLI release that sends the fields. Third-party receivers should update their schema from the same release, and the CLI's `--write-check-run` (used by hosted checks) writes the same document.
- `--format json` is unchanged.

## What newly leaves the machine
For security reviews, the complete list of new data in an uploaded run:
- digests of rules (derived from the rules, not from code);
- each rule's version, stage and enforcement label;
- exception IDs, the rule they cover, their expiry, `approvedBy` if present, and a count;
- the number of commits in the change, and per declared coding agent its name and a count.

No code, commit messages, SHAs, file contents or personal email addresses.

## Alternatives considered
- **A separate `ComplianceRecord` document.** Rejected: it would duplicate `CheckRun` and could drift from it. The record is what the run already is, with the missing context added.
- **Rule version only, no digest.** Rejected: local standards are often edited without bumping `version`, and customizations change a rule without changing its version. The digest is what makes a record verifiable.
- **Detecting AI-written code from the code itself.** Rejected: unreliable, and it would send or inspect code. Commit metadata is honest about what it is.
- **Signing runs in the CLI.** Deferred to a later RFC: signing needs key management. The rulebook digest is the foundation a signature would cover.

## Decisions (14 October 2026)
1. **Opt-out:** `--no-authorship` leaves `authorship` out, and `metadata.authorship: false` records that, like `metadata.snippets`.
2. **Teach rules count** in the rulebook digest: they shape what agents write even though their checks don't run.
3. **First agent markers:** Claude Code, Cursor, GitHub Copilot coding agent, Codex and Aider, each with a test.
