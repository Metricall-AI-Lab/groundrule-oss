# @groundrule/packs

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
