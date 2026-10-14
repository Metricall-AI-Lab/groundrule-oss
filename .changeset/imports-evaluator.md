---
"@groundrule/evaluators": minor
"@groundrule/packs": minor
"@groundrule/cli": minor
---

Architecture rules (ADR 0009). A new deterministic `imports` check: layers that must not import each other (`from` / `forbid` / `allow`), packages only some code may use (`package` / `only`), and `{placeholder}` captures so "feature modules reach each other only through their index" is one rule. Imports are resolved through relative paths, `tsconfig`/`jsconfig` `paths`, npm workspaces and Python packages; anything that doesn't resolve to the repository counts as a package and never as a layer violation. TypeScript, JavaScript and Python. A new `architecture` pack ships eight such rules (domain and application layers, feature modules, UI and data access, test code, monorepo entries, the payment SDK, the database client), all at Observe, with paths meant to be adjusted to your layout.
