# RFC 0015: The import graph in scan reports

- **Status:** Accepted (27 October 2026)
- **Author:** Groundrule maintainers
- **Spec version:** v1alpha1

## Summary
`groundrule scan` already resolves every import in the repository to propose boundaries and gates (RFC 0011). With `--upload`, the report now carries that resolved graph as `imports.graph`: one edge per import statement, as the importing file, its line, and either the repository path it resolved to or the package name. The platform keeps the latest graph per repository and uses it to answer, while an admin edits an `imports` rule, "N imports in your repositories would violate this today".

## Motivation
An architecture rule is a glob or two, and a glob is easy to get wrong in a way that says nothing or fires everywhere. Discovery proposes rules the code keeps; the editor should do the same for a rule a person writes, before it is published, from the repositories' real imports. The scan has the graph; sending it costs nothing the report does not already describe.

## Proposal
```yaml
imports:
  graph:
    edges:                                  # sorted by file, then line; at most 20,000
      - { file: src/domain/order.ts, line: 1, path: src/infra/db/client.ts }
      - { file: src/domain/order.ts, line: 3, package: zod }
    truncated: false                        # true when the cap cut the list
```

**Edges.** Every import the `imports` evaluator would see (ADR 0009, ADR 0011): TypeScript, JavaScript, Python, Java, Kotlin and Go, resolved the same way. `path` is a repository-relative file or directory; `package` is a package name or import path. Exactly one of the two is set. Nothing else: no specifier text, no code.

**Cap.** 20,000 edges, taken in file order, with `truncated: true` past it. A preview on a truncated graph says so.

**Where it runs.** With the other imports, under the same switch: on with `--upload`, off with `--no-import`. `--json` shows it.

**What the platform does with it.** Keeps the latest graph per repository (older scans' graphs are dropped with the scans themselves) and exposes a preview endpoint that runs the evaluator's matching over the stored edges for a check an admin is editing. The result is counts and a few example lines, like a discovery proposal.

## Privacy
File paths, line numbers and package names. Scan reports already carry file paths and lines in rule examples and in discovery proposals; package names are in manifests the scan reads today. The `what we store` page and the privacy policy name the graph explicitly.

## Compatibility
Additive and optional: `graph` defaults to absent, so older reports parse and older receivers reject reports carrying it until the platform updates, which ships before the CLI release.

## Alternatives considered
- **Previewing from discovery proposals only.** Rejected: a proposal exists only for a boundary the code keeps; the preview is most useful for a rule the code does not keep yet.
- **Re-scanning on the platform.** Rejected: the platform never has the code (ADR 0005), except in hosted checks, which are per pull request.
- **Sending the graph on every `check --upload`.** Rejected: a check run sees changed files; the scan sees the repository.
