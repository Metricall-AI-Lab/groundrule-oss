# ADR 0005: Scope semantics and what is never evaluated

- **Status:** Accepted
- **Date:** 2026-10-07

## Context
Building the runner surfaced ambiguities: should `scope.languages: [java]` exclude `pom.xml`? Should checks scan the standards themselves, which contain examples of forbidden code? Dogfooding showed both cause false positives.

## Decision
1. **Two levels of scope.** `languages`, `frameworks`, `tags`, and `repositories` decide whether a standard applies to a repository at all. `paths` and `exclude` decide which files it checks. A Java standard therefore still sees `pom.xml` if its paths include it.
2. **Never evaluated:**
   - the `.groundrule/` directory;
   - any YAML document declaring `apiVersion: groundrule.dev/...`, wherever it lives (e.g. an organization's shared standards repository);
   - files Groundrule generates (`.cursor/rules/groundrule*.mdc`, `.github/instructions/groundrule-*`), and Groundrule-managed blocks inside AGENTS.md, CLAUDE.md, and Copilot instructions. Line numbers outside managed blocks are preserved.
3. **Duplicate standard IDs are errors.** Inherited standards are customized with config `overrides`, never by redefining them.
4. **New vs legacy.** In change mode, a finding is new if its lines overlap changed lines (`changed-lines`) or its file changed (`changed-files`). Findings without a location are legacy. Only new findings fail unless `legacy: enforce`.

## Consequences
- Standards and agent files can quote forbidden code freely.
- Teams cannot exclude test fixtures from an inherited standard except with time-boxed exceptions. A per-override `exclude` is a likely future RFC.
