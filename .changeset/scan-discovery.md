---
"@groundrule/spec": minor
"@groundrule/core": minor
"@groundrule/evaluators": minor
"@groundrule/cli": minor
---

Architecture discovery in `groundrule scan` (RFC 0011): the boundaries and package gates a repository already keeps, read from its import graph, as proposals with the files that would fail each today. `ScanImports` gains `boundaries` and `gates`; the import scanner and resolver move to `@groundrule/core` (`buildImportGraph`, `discoverArchitecture`), and the `imports` evaluator uses them.
