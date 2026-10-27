# ADR 0012: Layout rules as a deterministic primitive

- **Status:** Accepted
- **Date:** 27 October 2026
- **Extends:** ADR 0009 (architecture rules as deterministic primitives)

## Context

ADR 0009 named `layout` as the primitive for "where files live and what they're called" and left it for later. The decisions it covers are common and simple to state: HTTP handlers live under the delivery directory; every source file has a test beside it or under `tests/`; file names are kebab-case; migrations are named by date. Agents break them as readily as import boundaries, and the existing `files` evaluator (files that must or must not exist, repository-wide) cannot say any of them, because they are about each file in a set, not about the set.

## Decision

A new built-in evaluator, `layout`, behind the existing `Evaluator` interface. It applies to every file in `from` (default: the standard's scope) and checks, per file, any of three things:

| Option | Says | Example |
|---|---|---|
| `name` (glob) or `namePattern` (regex) | What the file must be called. The glob matches the base name; the regex the base name too. | `namePattern: "^[a-z0-9-]+\.ts$"` |
| `place` (globs) | Where the file may live. A `from` file outside every `place` is a finding. | `from: ["**/*.controller.ts"]`, `place: ["src/api/**"]` |
| `companion` (patterns) | A file that must exist for it. `{dir}`, `{base}`, `{name}` and `{ext}` are the file's directory, name without extension, full name and extension. At least one pattern must match a repository file. | `companion: ["{dir}/{base}.test.ts", "tests/**/{base}.test.ts"]` |

At least one of the three is required; `exclude` skips files in `from` (a companion rule skips the test files themselves); `message` and `remediation` as in every evaluator. Each finding is on the file at line 1, with evidence that says which option failed and what was expected. Confidence is certain: everything is a file name.

Two decisions keep it precise:

- **`from` is the subject, never the test.** The rule checks files that already match `from`; it never looks for files that should match `from` and don't. "Every controller is under api/" is a layout rule; "there should be a controller" is a `files` rule.
- **Companions resolve against every file in the standard's scope**, not only the files under check, so a changed source file finds its unchanged test. The test files therefore stay in the scope and are skipped with the check's `exclude`, never with `scope.exclude`.

Two pack rules show the shapes, both at Observe: ARCH-009, every source file has a test file (companion); ARCH-010, HTTP handlers live under the delivery directory (place).

## Consequences

- No change to the `Evaluator` interface or the document format: one evaluator, one changeset, and the dashboard's editor lists it.
- Deterministic and cheap: file names only, no file is read.
- Discovery of layout rules (the detected layout proposed as rules, deferred in RFC 0011) stays deferred; the primitive comes first.
