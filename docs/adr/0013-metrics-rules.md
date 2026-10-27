# ADR 0013: Metrics rules as a deterministic primitive

- **Status:** Accepted
- **Date:** 27 October 2026
- **Extends:** ADR 0009 (architecture rules as deterministic primitives)

## Context

ADR 0009 named `metrics` as the primitive for size and complexity limits and left it for later. The limits teams actually write down are few and plain: a file no longer than N lines, a function no longer than N lines, no more than N parameters, nesting no deeper than N. Coding agents break them in a characteristic way, by growing the function they are in rather than splitting it, and reviewers notice late. Linters can check some of these per language, but a rule in the rulebook reaches every agent file and every check in the same words.

## Decision

A new built-in evaluator, `metrics`, behind the existing `Evaluator` interface, with four limits, any subset of which a check may set:

| Option | Measures |
|---|---|
| `maxFileLines` | Lines in the file. |
| `maxFunctionLines` | Lines from a function's header to its closing brace, or to the end of its indented body in Python. |
| `maxParameters` | Declared parameters of a function; Python's `self` and `cls` are not counted. |
| `maxNesting` | Blocks nested inside a function's body: a function whose body is one `if` with one `for` inside has nesting 2. |

`from` and `exclude` choose the files, as in `layout`; `message` and `remediation` as in every evaluator.

**Languages.** The same six the `imports` check reads: TypeScript, JavaScript, Python, Java, Kotlin and Go. Functions are found with tolerant patterns, as imports are (ADR 0009): function declarations, methods and arrow functions assigned to a name in TypeScript and JavaScript; `def` in Python; methods and Kotlin `fun` in Java and Kotlin; `func` in Go. Bodies are measured by brace matching over text with comments and strings blanked, or by indentation in Python.

**Confidence.** A file's line count is certain. Function measurements are reported as `high`: a brace inside an unusual string or a pattern that is not a function could shift them, and the finding says what it measured so a person can see it. A rule with function limits therefore counts as a deterministic check for a blocker, but its findings carry the confidence they deserve.

**What is deliberately not here.** Cyclomatic complexity, cognitive complexity and coupling metrics: they need a parser to mean anything, and the honest version of each is a Semgrep rule or a language linter the `tool-setting` import already recognises. Nesting is the one complexity measure this evaluator takes, because it is what a reader sees.

Two pack rules show the shapes, both advisory and at Observe: ARCH-011, files stay under 500 lines; ARCH-012, functions stay short and flat (60 lines, 5 parameters, nesting 4).

## Consequences

- No change to the `Evaluator` interface or the document format: one evaluator, one changeset, and the dashboard's editor lists it.
- Each finding is on the function's header line (or line 1 for the file), with the measured number and the limit in its message, so an agent told about it knows what to split.
- A function the patterns miss is never a false finding, only a missed one; a construct mistaken for a function (a control-flow keyword is excluded by name) would measure a block, which the `high` confidence and the evidence make visible.
