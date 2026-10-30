# @groundrule/packs

## 0.24.1

### Patch Changes

- @groundrule/core@0.24.1
  - @groundrule/spec@0.24.1

## 0.24.0

### Minor Changes

- d700de0: Action policies (RFC 0017): a second policy kind, `ActionPolicy`, says what a coding agent may do on its own, what needs a person, and what is refused. `groundrule hooks` now installs a before-tool hook for Claude Code, Codex, Cursor and Copilot that decides shell commands, edits, reads, fetches and MCP calls against the policies in effect (`allow`, `ask`, `deny`; default `ask`), with exceptions and rollout stages applying as they do for standards. The rules for a file before an edit (ADR 0010) ride along in the same answer. A new pack, `groundrule:packs/agent-actions`, ships ten policies (force-pushes, history rewrites, hook bypass, piping downloads into a shell, publishing, infrastructure changes, elevated privileges, deleting outside the repository, secret files, CI workflows). Agent files gain a section "What you may not do alone". In a connected repository, `ask` and `deny` decisions are reported to the workspace as counts and policy ids, never the command or path.

### Patch Changes

- Updated dependencies [d700de0]
  - @groundrule/spec@0.24.0
  - @groundrule/core@0.24.0

## 0.23.1

### Patch Changes

- @groundrule/core@0.23.1
  - @groundrule/spec@0.23.1

## 0.23.0

### Minor Changes

- 4aa58f8: **The `metrics` check (ADR 0013):** size and complexity limits, deterministic, for TypeScript, JavaScript, Python, Java, Kotlin and Go: `maxFileLines`, `maxFunctionLines`, `maxParameters` and `maxNesting`, with `from` and `exclude`. Function measurements are reported at `high` confidence; a file's line count is certain. ARCH-011 (files stay under 500 lines) and ARCH-012 (functions stay short and flat) use it. **Layout discovery (RFC 0016):** `groundrule scan` reports the layout conventions the code already keeps as proposed `layout` rules in `imports.layouts`: where a kind of file lives (`*.controller.ts` under `api/`) and the companion every source file has (`{dir}/{base}.test{ext}`), each with the files that would fail it today; the summary prints them under Layout.

### Patch Changes

- Updated dependencies [4aa58f8]
  - @groundrule/spec@0.23.0
  - @groundrule/core@0.23.0

## 0.22.0

### Minor Changes

- 2040dff: Two more architecture pieces. **The import graph in scan reports (RFC 0015):** `groundrule scan --upload` sends `imports.graph`, every import resolved to a repository path or a package (file, line, target; never code; 20,000 edges at most), so the platform can preview an `imports` rule against the repositories' real imports while it is edited; `--no-import` leaves it out. `@groundrule/evaluators` exports `compileImportRule` and `previewImports` for that. **The `layout` check (ADR 0012):** where files live and what they are called: `name` or `namePattern` for the base name, `place` for the directories a kind of file may live under, and `companion` patterns for a file that must exist for it (`{dir}/{base}.test{ext}`). Two architecture rules use it: ARCH-009, every source file has a test file; ARCH-010, HTTP handlers live in the delivery layer.

### Patch Changes

- Updated dependencies [2040dff]
  - @groundrule/spec@0.22.0
  - @groundrule/core@0.22.0

## 0.21.0

### Minor Changes

- 18a1b20: Architecture rules for Java, Kotlin and Go (ADR 0011). The `imports` check and `groundrule scan`'s architecture discovery now read `.java`, `.kt`, `.kts` and `.go` files: Java and Kotlin imports resolve through Maven and Gradle source roots (`src/main/java`, `src/main/kotlin`, nested classes and wildcard imports included), Go imports through every `go.mod` in the repository, nested modules included. Unresolved imports are packages, so a gate is written as `package: "org.springframework.jdbc.*"` or `"github.com/stripe/**"`. Discovery proposes Java modules under the source root's shared package and Go modules under `internal`, `pkg` and `cmd`, and gates the JDBC, JPA, Hibernate, cloud, HTTP-client, Redis, Kafka, GORM, pgx and driver packages. The `architecture` pack's directory and package rules (ARCH-001, 002, 005, 007, 008) apply to the three languages, with Java and Go examples.

### Patch Changes

- Updated dependencies [18a1b20]
  - @groundrule/core@0.21.0
  - @groundrule/spec@0.21.0

## 0.20.0

### Patch Changes

- Updated dependencies [be592fc]
  - @groundrule/spec@0.20.0
  - @groundrule/core@0.20.0

## 0.19.0

### Patch Changes

- @groundrule/core@0.19.0
  - @groundrule/spec@0.19.0

## 0.18.1

### Patch Changes

- @groundrule/core@0.18.1
  - @groundrule/spec@0.18.1

## 0.18.0

### Patch Changes

- Updated dependencies [89ee403]
  - @groundrule/spec@0.18.0
  - @groundrule/core@0.18.0

## 0.17.0

### Patch Changes

- @groundrule/core@0.17.0
  - @groundrule/spec@0.17.0

## 0.16.0

### Patch Changes

- Updated dependencies [1d1a810]
- Updated dependencies [42c9562]
  - @groundrule/spec@0.16.0
  - @groundrule/core@0.16.0

## 0.15.0

### Patch Changes

- Updated dependencies [ab2cbb5]
  - @groundrule/spec@0.15.0
  - @groundrule/core@0.15.0

## 0.14.0

### Minor Changes

- c1bccc7: Architecture rules (ADR 0009). A new deterministic `imports` check: layers that must not import each other (`from` / `forbid` / `allow`), packages only some code may use (`package` / `only`), and `{placeholder}` captures so "feature modules reach each other only through their index" is one rule. Imports are resolved through relative paths, `tsconfig`/`jsconfig` `paths`, npm workspaces and Python packages; anything that doesn't resolve to the repository counts as a package and never as a layer violation. TypeScript, JavaScript and Python. A new `architecture` pack ships eight such rules (domain and application layers, feature modules, UI and data access, test code, monorepo entries, the payment SDK, the database client), all at Observe, with paths meant to be adjusted to your layout.

### Patch Changes

- @groundrule/core@0.14.0
  - @groundrule/spec@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [84ca988]
  - @groundrule/spec@0.13.0
  - @groundrule/core@0.13.0

## 0.12.0

### Minor Changes

- 9d4dd77: SOC 2 and ISO 27001 mappings across the catalog: 117 of 171 rules now name the SOC 2 criteria they support (CC6.1, CC6.6, CC6.7, CC6.8, CC7.1, CC7.2, CC8.1, A1.2) and 120 the ISO/IEC 27001:2022 Annex A controls (5.15, 5.17, 8.3, 8.5, 8.6, 8.8, 8.9, 8.11, 8.12, 8.15, 8.19, 8.20, 8.24 to 8.26, 8.28, 8.29, 8.31, 8.32), up from 14 and 17. A mapping means following the rule contributes evidence for the control, never that it satisfies it. `COMPLIANCE_CONTROLS` and `COMPLIANCE_FRAMEWORK_NAMES` give the names, for reports.

### Patch Changes

- @groundrule/core@0.12.0
  - @groundrule/spec@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [b04cf69]
  - @groundrule/spec@0.11.0
  - @groundrule/core@0.11.0

## 0.10.0

### Patch Changes

- Updated dependencies [21c3da7]
  - @groundrule/spec@0.10.0
  - @groundrule/core@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies [f24d807]
  - @groundrule/spec@0.9.0
  - @groundrule/core@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [943c0bc]
  - @groundrule/core@0.8.0
  - @groundrule/spec@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [dca0b2e]
  - @groundrule/core@0.7.0
  - @groundrule/spec@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [88fdead]
  - @groundrule/spec@0.6.0
  - @groundrule/core@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [136141a]
  - @groundrule/spec@0.5.0
  - @groundrule/core@0.5.0

## 0.4.0

### Patch Changes

- @groundrule/core@0.4.0
  - @groundrule/spec@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [baa71da]
  - @groundrule/spec@0.3.0
  - @groundrule/core@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [f165c4e]
  - @groundrule/spec@0.2.0
  - @groundrule/core@0.2.0

## 0.1.1

### Patch Changes

- 2c0cfbb: Fix links in the package READMEs on npm: they pointed to files relative to the repository, which don't exist on npmjs.com. They now link to the CLI docs and to the repository on GitHub.
- @groundrule/core@0.1.1
  - @groundrule/spec@0.1.1

## 0.1.0

### Minor Changes

- b4757b4: `groundrule scan` imports what a repository already has as proposals: instructions from agent files (split by heading and list item, de-duplicated, matched to similar catalog rules), linter and compiler settings that enforce catalog rules, and CODEOWNERS entries. `--no-import` leaves them out.

### Patch Changes

- Updated dependencies [2ee2e56]
- Updated dependencies [ddf5aef]
- Updated dependencies [b4757b4]
  - @groundrule/spec@0.1.0
  - @groundrule/core@0.1.0
