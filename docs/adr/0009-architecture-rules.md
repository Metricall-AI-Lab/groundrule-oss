# ADR 0009: Architecture rules as deterministic primitives

- **Status:** Accepted
- **Date:** 15 October 2026

## Context

Architectural decisions ("the domain layer never imports infrastructure", "only the payments module uses the payment SDK", "feature modules reach each other through their public entry") are what coding agents break most and what AI reviewers catch least reliably. Teams express many kinds of such decisions, and a single feature can't anticipate them all. Existing tools for this (dependency-cruiser, ESLint boundary plugins) are precise but so costly to configure that most teams never do.

## Decision

Architecture is not one evaluator. It is a small set of **deterministic primitives**, each a plugin behind the existing `Evaluator` interface, which together express most architectural decisions; the decisions themselves are ordinary standards, pre-defined in packs or written by a team.

| Kind of decision | Primitive |
|---|---|
| Dependency direction, module boundaries, technology per area, cycles | `imports` (this ADR) |
| Where files live and what they're called | `layout` (later) |
| Size and complexity limits | `metrics` (later) |
| Things that change together | `change-set` (exists) |
| Required structure | `files` (exists) |
| Framework usage | `regex`, `semgrep` (exist) |
| Semantic invariants | AI review, labelled advisory (exists) |

The `imports` evaluator checks import statements of the files under evaluation, in three shapes:

- **Layers:** files matching `from` must not import repository code matching `forbid`, with `allow` exceptions.
- **Package gates:** only files matching `only` may import a `package` (a name or glob).
- **Placeholders:** `{name}` in `from` captures a path segment and is substituted into `forbid` and `allow`, so "features don't import each other except through their index" is one rule.

Imports are resolved to repository paths: relative paths; `tsconfig.json` / `jsconfig.json` `baseUrl` and `paths`; npm workspaces by package name; Python packages by directory (the repository, `src/`, and top-level packages). **Whatever doesn't resolve to the repository is a package**, so a layer rule can never fire on an import it didn't understand; a gate fires only on a package name that matches. That is the rule that keeps precision near certain, which is what lets these rules reach Enforce. TypeScript, JavaScript and Python first; Java and Go later in the same evaluator.

Pre-defined decisions ship as the `architecture` pack, every rule at Observe so adoption is evidence-first; the paths in each rule's check are the conventional ones and are meant to be adjusted in the rulebook. A later slice adds **discovery** to `groundrule scan`: the import graph of a repository, the layout it detects, and proposed boundary rules with their current violation counts, routed through the review inbox.

## Consequences

- No change to the `Evaluator` interface or the document format: a new built-in evaluator and a pack. Third-party evaluators remain the answer for a team's own analysers.
- The evaluator scans with tolerant regular expressions rather than a parser: imports are syntactically simple, and a parser dependency would be large for little gain. Imports built from variables are invisible, which is rare and never a false violation.
- Generated agent files describe the boundaries, and the stop hook and MCP `check` run the rule inside the agent loop, so an agent that adds a forbidden import is told before the pull request exists.
