# RFC 0011: Architecture discovery in scans

- **Status:** Accepted (16 October 2026)
- **Author:** Groundrule maintainers
- **Spec version:** v1alpha1

## Summary
`groundrule scan` reads the repository's import graph and reports the boundaries the code already keeps: modules that depend on one another in one direction only, and packages used from one module only. Each is a proposed `imports` rule (ADR 0009) with its evidence and the files that would fail it today, in a new `boundaries` and `gates` section of `ScanImports` (RFC 0004). Uploaded, they become proposals in the review inbox, so a team adopts an architecture rule by accepting what its code already does, without writing a glob.

## Motivation
The `architecture` pack ships the conventional decisions with conventional paths, and a team whose layout differs has to edit globs before a rule says anything true. Most repositories already have an architecture, visible in which modules import which: the domain never imports infrastructure, only one module touches the payment SDK. Reading that graph and proposing it as rules turns configuration into review, which is the adoption model everything else in the scan already uses.

## Proposal
```yaml
imports:
  boundaries:                      # at most 25, strongest direction first
    - from: src/domain             # the module that must not import
      forbid: src/infra            # the module it must not import
      files: 14                    # files in `from`
      importsBack: 9               # files in `forbid` that import `from`: the evidence
      violations: 1                # files in `from` that import `forbid` today
      examples:                    # at most 3
        - { file: src/domain/order.ts, line: 1, target: src/infra/db.ts }
      fingerprint: <sha256 of "boundary", from, forbid>
  gates:                           # at most 15, most users first
    - package: stripe
      only: src/payments           # the module that uses it
      users: 5                     # files in `only` that import it
      violations: 0                # files elsewhere that import it today
      examples: []                 # at most 3, { file, line }
      fingerprint: <sha256 of "gate", package, only>
```

**Modules.** A file's module is its first directory under a source root (`src`, `app`, `lib`, `source`), under a workspace root (`packages/*`, `apps/*`, `libs/*`, `services/*`, `modules/*`, and their own `src/<dir>` when present), or its top-level directory. Directories with fewer than three TypeScript, JavaScript or Python files are not modules.

**Boundaries.** For modules A and B, count files in B that import A (`importsBack`) and files in A that import B (`violations`), resolving imports the way the `imports` evaluator does (relative paths, `tsconfig`/`jsconfig` `paths`, npm workspaces, Python packages; whatever doesn't resolve is a package). Propose "A must not import B" when `importsBack` ≥ 3 and `violations` ≤ max(1, ⌊0.2 × importsBack⌋). The threshold is what makes a proposal a boundary the code keeps rather than a direction it happens to lean: a module that imports back a fifth of the time has no boundary to propose.

**Gates.** For a package on the gated list (payment SDKs, database clients and ORMs, HTTP clients, cloud SDKs, email, queues, auth and hashing libraries), count files per module that import it. Propose "only M uses it" when the top module has ≥ 3 users and the rest together have ≤ max(1, ⌊0.2 × users⌋). Only listed packages are considered: a utility used everywhere is not a gate, and the list is the place to grow coverage.

**Rules from proposals.** A boundary becomes an `imports` check `{ from: ["<from>/**"], forbid: ["<forbid>/**"] }`; a gate becomes `{ package: "<package>", only: ["<only>/**"] }`. The platform builds the standard on accept; the CLI prints the proposal with its counts, and `--json` carries all of it. `fingerprint` dedupes a proposal across scans, as instruction fingerprints do.

**Where it runs.** With the other imports: on by default, off with `--no-import`. Nothing in it is new data leaving the computer beyond what RFC 0004 sends; proposals name directories and at most three file paths with line numbers, no code.

## Compatibility
Additive: `boundaries` and `gates` default to empty, so older reports parse and older receivers reject reports carrying them until the platform updates, which ships before the CLI release. The scanner and resolver move from `@groundrule/evaluators` into `@groundrule/core` (`buildImportGraph`, `discoverArchitecture`); the evaluator's behaviour and options are unchanged.

## Alternatives considered
- **Proposing every direction with a majority.** Rejected: a rule a team accepts and then weakens at the first violation teaches that rules are noise. The thresholds are set so a proposal is close to true today.
- **Learning gates from any package.** Rejected: packages used from one module are mostly the module's own concern (a date library in one place); the gated list names the packages whose spread is an architectural cost.
- **A parser-based graph.** Rejected as in ADR 0009: the tolerant scanner already resolves what matters, and discovery tolerates the rare miss better than a check does.
- **Proposing `layout` rules from the detected layout.** Deferred to the `layout` primitive; the module detection here is its first half.
