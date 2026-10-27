# @groundrule/evaluators

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

### Minor Changes

- 89ee403: AI checks (RFC 0013): the `llm` evaluator's options are now `question`, `include`, `exclude` and `minConfidence`, answered by Groundrule's hosted checks over the changed lines of the files the rule names; locally and in CI the rule is reported as not run. `groundrule check --ai-requests <file>` writes the review requests (`AiReviewRequests`: hunks with context, secrets redacted, within per-run limits) for the hosted worker.

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

### Minor Changes

- ab2cbb5: Architecture discovery in `groundrule scan` (RFC 0011): the boundaries and package gates a repository already keeps, read from its import graph, as proposals with the files that would fail each today. `ScanImports` gains `boundaries` and `gates`; the import scanner and resolver move to `@groundrule/core` (`buildImportGraph`, `discoverArchitecture`), and the `imports` evaluator uses them.

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

- @groundrule/core@0.1.1
  - @groundrule/spec@0.1.1

## 0.1.0

### Patch Changes

- Updated dependencies [2ee2e56]
- Updated dependencies [ddf5aef]
- Updated dependencies [b4757b4]
  - @groundrule/spec@0.1.0
  - @groundrule/core@0.1.0
