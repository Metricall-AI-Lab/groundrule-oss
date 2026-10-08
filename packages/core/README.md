# @groundrule/core

The Groundrule engine.

- `loadFile` / `parseDocument` — parse and validate YAML with file:line:column diagnostics.
- `matchesScope` — decide whether a standard applies to a path, repository, language, or tag.
- `computeFingerprint` — stable finding identity for baselines and feedback.
- `Evaluator` / `defineEvaluator` — the plugin interface every check implements.
