---
"@groundrule/spec": minor
"@groundrule/core": minor
"@groundrule/evaluators": minor
"@groundrule/packs": minor
"@groundrule/cli": minor
---

Two more architecture pieces. **The import graph in scan reports (RFC 0015):** `groundrule scan --upload` sends `imports.graph`, every import resolved to a repository path or a package (file, line, target; never code; 20,000 edges at most), so the platform can preview an `imports` rule against the repositories' real imports while it is edited; `--no-import` leaves it out. `@groundrule/evaluators` exports `compileImportRule` and `previewImports` for that. **The `layout` check (ADR 0012):** where files live and what they are called: `name` or `namePattern` for the base name, `place` for the directories a kind of file may live under, and `companion` patterns for a file that must exist for it (`{dir}/{base}.test{ext}`). Two architecture rules use it: ARCH-009, every source file has a test file; ARCH-010, HTTP handlers live in the delivery layer.
