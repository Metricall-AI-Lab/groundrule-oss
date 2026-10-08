# RFC 0003: Scan reports

- **Status:** Accepted
- **Author:** Groundrule maintainers
- **Spec version:** v1alpha1

## Summary
Add `ScanReport`, the output of `groundrule scan`: what a repository already has (stack, coding-agent instruction files, tool configurations) and how every applicable catalog rule would do today, observed without enforcing anything. It is the contract between the open-source CLI and any service that receives scans, so it lives in the spec and has a JSON Schema (`scan-report.schema.json`).

## Motivation
Adopting standards should start from evidence in the organization's own code, not guesses. A scan answers: which packs fit this repository, which rules already pass (safe to enforce today), which would be noisy, and what instructions agents already get. The format must be explicit about what leaves the machine, so security teams can review it.

## Proposal
```yaml
apiVersion: groundrule.dev/v1alpha1
kind: ScanReport
metadata: { generatedAt: 2026-10-08T10:00:00Z, cliVersion: 0.2.0, durationMs: 350, snippets: true }
repository: { name: acme/payments-api, commit: <40 hex>, branch: main, files: 812 }
stack: { languages: [typescript], frameworks: [react] }
agentFiles:   # path, kind, size, hash, and structure counts; never contents
  - { path: AGENTS.md, kind: agents-md, lines: 120, bytes: 4100, sha256: <hex>, managed: false, headings: 6, bullets: 31 }
tools:        # a few facts per tool, never file contents
  - { id: typescript, path: tsconfig.json, facts: { strict: true, files: 3 } }
rules:
  - id: TS-001
    version: 1
    pack: groundrule:packs/typescript-node
    severity: warning
    outcome: violations      # clean | violations | guidance | not-applicable | not-evaluable
    findings: 23
    filesInScope: 140        # files the rule's checks actually look at
    filesAffected: 9
    examples:                # at most 3
      - { file: src/app.ts, line: 12, message: console.log in application code, snippet: 'console.log(order)' }
summary: { rules: 171, clean: 41, violations: 9, guidance: 30, notApplicable: 91, notEvaluable: 0, findings: 37 }
```
- `clean` requires something to check (`filesInScope > 0`); a rule with nothing to look at is `not-applicable`.
- Snippets are one line, at most 200 characters, with credential-shaped values replaced by `[redacted]`. Rules in the `security` category never include snippets. `metadata.snippets: false` (`--no-snippets`) omits all of them.
- Bounded sizes: at most 100 agent files, 100 tools, 2000 rules, 3 examples per rule.

## Compatibility
Additive: a new document kind. It is not a configuration document and is never loaded from a repository.

## Alternatives considered
- SARIF: describes findings, not a repository's stack, agent files, or per-rule adherence, and encourages full result lists rather than bounded examples.
