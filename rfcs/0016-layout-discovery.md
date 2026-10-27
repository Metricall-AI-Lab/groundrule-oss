# RFC 0016: Layout discovery in scans

- **Status:** Accepted (27 October 2026)
- **Author:** Groundrule maintainers
- **Spec version:** v1alpha1

## Summary
`groundrule scan` reports the layout conventions the repository already keeps, as proposed `layout` rules (ADR 0012) with the files that would fail each today, in a new `layouts` list of `ScanImports` (RFC 0004), beside `boundaries` and `gates` (RFC 0011). Two shapes: where a kind of file lives ("every `*.controller.ts` is under `api/`") and the companion every source file has ("every source file has a `.test.ts` beside it"). Uploaded, they are proposals in the review inbox, and accepting one creates a standard with a `layout` check.

## Motivation
RFC 0011 deferred layout discovery until the primitive existed. It exists now, and the same argument holds: a team adopts a convention most easily by accepting what its code already does, with the exceptions in front of it, rather than by writing a glob.

## Proposal
```yaml
imports:
  layouts:                          # at most 15, most files first
    - kind: place
      from: ["**/*.controller.ts"]  # the kind of file
      place: ["**/api/**"]          # where it lives
      files: 14                     # files of that kind
      violations: 1                 # of them, outside `place` today
      examples: [{ file: src/jobs/nightly.controller.ts }]   # at most 3
      fingerprint: <sha256 of "layout", kind, from, place>
    - kind: companion
      from: ["src/**/*.ts"]
      exclude: ["**/*.test.*", "**/*.spec.*", "**/*.d.ts", "**/index.*"]
      companion: ["{dir}/{base}.test{ext}"]
      files: 52                     # source files considered
      violations: 4                 # of them, without the companion today
      examples: [{ file: src/orders/service.ts }]
      fingerprint: <sha256 of "layout", kind, from, companion>
```

**Kinds of file.** A file's kind is its name's suffix: the last dotted segment before the extension (`orders.controller.ts` → `*.controller.ts`), an underscore suffix from a known list (`orders_handler.go` → `*_handler.go`), or a CamelCase suffix from a known list (`OrdersController.java` → `*Controller.java`). Test, spec, stories, declaration and config suffixes are not kinds.

**Places.** For a kind with at least three files, the directory name that contains most of them, as a path segment anywhere in the path. Propose "lives under it" when that covers at least 80% of the kind's files; the rest are the violations. Source and workspace roots (`src`, `app`, `lib`, `main`, `java`, `kotlin`, `internal`, `pkg`, `cmd`, `packages`, `apps`, …) are never the place.

**Companions.** Per language family, the test conventions the evaluator can express: `{dir}/{base}.test{ext}`, `{dir}/{base}.spec{ext}`, `{dir}/__tests__/{base}.test{ext}` and `tests/**/{base}.test{ext}` for TypeScript and JavaScript; `{dir}/test_{name}`, `{dir}/tests/test_{name}` and `tests/**/test_{name}` for Python; `{dir}/{base}_test.go` for Go; `src/test/**/{base}Test{ext}` for Java and Kotlin. Source files are the family's files outside tests, index files, declarations, configuration and generated code. Propose the convention with the most coverage when it covers at least 80% of at least five source files; the rest are the violations.

**Rules from proposals.** A place becomes a `layout` check `{ from, place }`; a companion `{ from, exclude, companion }`. The platform builds the standard on accept; `fingerprint` dedupes across scans.

**Where it runs.** With the other imports: on by default, off with `--no-import`. Nothing new leaves the computer beyond file paths, which discovery already sends.

## Compatibility
Additive: `layouts` defaults to empty, so older reports parse and older receivers reject reports carrying them until the platform updates, which ships before the CLI release.

## Alternatives considered
- **Proposing naming rules (kebab-case, PascalCase).** Deferred: the evidence is weaker (a repository rarely has one case for every file kind) and the cost of a wrong proposal is a noisy rule.
- **Learning the companion pattern from any pair of files.** Rejected: the known conventions cover what test runners find; an invented pattern would propose a rule no runner honours.
