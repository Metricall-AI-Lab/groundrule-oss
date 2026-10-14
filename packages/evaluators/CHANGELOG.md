# @groundrule/evaluators

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
