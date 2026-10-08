# ADR 0003: Every check is an evaluator plugin

- **Status:** Accepted
- **Date:** 2026-10-07

## Context
Standards range from forbidden dependencies (deterministic) to "authorization at the service boundary" (semantic) to process rules about the shape of a change. The foundation must fit all of them without special cases.

## Decision
A standard lists `checks`. Each check names an `evaluator` by ID; all other keys are options validated by that evaluator's own Zod schema. Evaluators implement one interface (`packages/core/src/evaluator.ts`) and declare their `source` (deterministic, static-analysis, ai, external), which is shown with every finding. The runner, not the evaluator, assigns severity, new-vs-legacy, exceptions, and fingerprints.

## Consequences
- Adding a capability means adding an evaluator, never changing the core or the spec.
- Third parties can publish evaluators.
- Check options are only fully validated once the evaluator is known; the loader validates the envelope.
- Validated against four foundation standards in `examples/foundation`.

## Amendment (2026-10-07, Milestone 1)
Three additions found necessary while building the first evaluators:
- `EvalContext.targetFiles`: files whose content to scan (changed files in diff mode). `files` stays the full in-scope list, so repository-level checks such as required files still see everything.
- `EvaluateInput.standardDir`: lets checks reference files next to the standard (e.g. Semgrep rules).
- `supports()` returns `true` or an actionable reason string ("Install semgrep: ...") instead of a bare boolean, so users learn how to fix an unavailable check.
