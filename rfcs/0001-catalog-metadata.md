# RFC 0001: Catalog metadata for standards and packs

- **Status:** Accepted
- **Author:** Groundrule maintainers
- **Spec version:** v1alpha1

## Summary
Add optional fields that let a standard explain where it comes from, what it supports, who it is for, how noisy it is, and how to roll it out: structured `references`, `compliance` mappings, `applicability`, `quality`, and `rollout` on standards; `version`, `tags`, and `applicability` on packs. All fields are optional and backward compatible.

## Motivation
Organizations adopting Groundrule should start from a catalog of ready-made standards instead of writing their own. To trust and choose catalog standards quickly, adopters need to know:

- **Where a rule comes from.** Security teams want CWE and OWASP references, not just a sentence.
- **What it supports.** Compliance owners want to see which SOC 2, ISO 27001, ASVS, PCI DSS, or HIPAA controls a rule contributes to.
- **Whether it fits.** A Spring rule is irrelevant to a Go service; tools need machine-readable applicability to recommend the right rules.
- **How noisy it is.** A rule that floods pull requests gets turned off. Adopters need an honest noise rating and the known false-positive cases.
- **How to start.** Rolling out a blocker on day one is risky. Authors know whether a rule is safe to enforce immediately or should be observed first.

Packs also need a version so tools can show "your version vs upstream" when a pack changes.

## Proposal

### Rollout stages (new shared enum)
`observe` < `teach` < `advise` < `enforce`:

| Stage | Meaning |
|---|---|
| `observe` | Checks run silently; results are recorded only. |
| `teach` | Delivered to coding agents; checks still run silently. |
| `advise` | Findings are shown but never fail a check. |
| `enforce` | Findings count at the standard's severity; blockers fail the check. |

The stage an organization actually uses is organization state (configuration or platform), not part of the standard. The standard only records the author's recommendation.

### Standard

```yaml
spec:
  # Widened: a URL (as before) or a catalog entry with optional title and URL.
  references:
    - https://example.com/adr/12
    - { id: CWE-321, title: Use of Hard-coded Cryptographic Key }
  # New: controls this standard supports. Evidence, never certification.
  compliance:
    - { framework: soc2, controls: [CC6.1] }
    - { framework: iso-27001, controls: ["8.24", "5.17"] }
  # New: who the standard is relevant to. Used for recommendations only.
  applicability:
    languages: [java]
    frameworks: [spring-boot]
    files: ["**/pom.xml"]
    dependencies: [spring-boot-starter-web]
  # New: what adopters can expect from the checks.
  quality:
    noise: low            # low | medium | high
    knownFalsePositives:
      - Test fixtures that contain dummy keys; exclude them with scope.exclude.
  # New: where to start when adopting.
  rollout:
    recommendedStage: enforce   # observe | teach | advise | enforce
```

Rules:
- A reference object needs an `id`, a `url`, or both. Tools derive URLs for well-known IDs (`CWE-<n>`).
- `compliance.framework` is a slug. Known IDs: `soc2`, `iso-27001`, `owasp-asvs`, `pci-dss`, `hipaa`, `nist-ssdf`. Others are allowed (e.g. an internal policy).
- `applicability` never narrows where an adopted standard is checked; that remains `scope`. When `applicability` is omitted, tools treat the standard as relevant wherever its `scope` languages and frameworks fit.

### Pack

```yaml
metadata:
  version: 1.0.0               # semantic version; bump when any standard changes
  tags: [security, baseline]
spec:
  applicability:
    files: ["**/package.json"]
```

### Catalog quality bar (not enforced by the schema)
Standards bundled in `@groundrule/packs` must set `rollout`, `quality`, and either `intent` or `rationale`; standards with checks must set `remediation`; security standards must cite at least one reference. Packs must set `version`. A test in `packages/packs` enforces this.

## Compatibility
Backward compatible. Every new field is optional, and `references` accepts everything it accepted before (URLs). Existing documents parse unchanged. Older tools reject the new fields (standards are strict objects), so catalog content using them requires `@groundrule/spec` with this RFC.

## Alternatives considered
- **Put catalog data in a separate index file.** Keeps standards small, but metadata drifts from the rule it describes and user-authored standards could not use it.
- **Store the organization's rollout stage in the standard.** Rejected: the same catalog standard is at different stages in different organizations and repositories.
- **A fixed enum of compliance frameworks.** Rejected: organizations map to internal policies too; a known list for display is enough.

## Open questions
- Measured precision from the catalog test harness (Phase A3) could be published alongside `quality.noise`; the shape will be proposed with the harness.
