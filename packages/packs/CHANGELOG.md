# @groundrule/packs

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
