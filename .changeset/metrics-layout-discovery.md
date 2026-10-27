---
"@groundrule/spec": minor
"@groundrule/core": minor
"@groundrule/evaluators": minor
"@groundrule/packs": minor
"@groundrule/cli": minor
---

**The `metrics` check (ADR 0013):** size and complexity limits, deterministic, for TypeScript, JavaScript, Python, Java, Kotlin and Go: `maxFileLines`, `maxFunctionLines`, `maxParameters` and `maxNesting`, with `from` and `exclude`. Function measurements are reported at `high` confidence; a file's line count is certain. ARCH-011 (files stay under 500 lines) and ARCH-012 (functions stay short and flat) use it. **Layout discovery (RFC 0016):** `groundrule scan` reports the layout conventions the code already keeps as proposed `layout` rules in `imports.layouts`: where a kind of file lives (`*.controller.ts` under `api/`) and the companion every source file has (`{dir}/{base}.test{ext}`), each with the files that would fail it today; the summary prints them under Layout.
