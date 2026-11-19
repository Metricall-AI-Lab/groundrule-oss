# @groundrule/reporters

## 0.25.0

### Minor Changes

- e308ef9: A guided start. `groundrule` alone, in a repository with no configuration, now takes a first look: it detects the stack, runs the checks over the whole repository and shows what they find today without writing anything, says how many rules are checked on every change and how many are instructions for coding agents only, then asks one question and sets the repository up (config, agent files, hooks). `groundrule start` is the same thing by name; `--yes` sets up without asking and `--no-hooks` leaves the hooks out. With nobody at the terminal it writes nothing and says how to finish.
  
  `groundrule check` says more plainly what it left out: "N existing findings, not from this change (show with --verbose or --all)", and the summary reads "N guidance, not checked". `init` now points at `check --all` as the next step, so the first result is the repository as it stands.

### Patch Changes

- @groundrule/core@0.25.0
  - @groundrule/spec@0.25.0

## 0.24.1

### Patch Changes

- @groundrule/core@0.24.1
  - @groundrule/spec@0.24.1

## 0.24.0

### Patch Changes

- Updated dependencies [d700de0]
  - @groundrule/spec@0.24.0
  - @groundrule/core@0.24.0

## 0.23.1

### Patch Changes

- @groundrule/core@0.23.1
  - @groundrule/spec@0.23.1

## 0.23.0

### Patch Changes

- Updated dependencies [4aa58f8]
  - @groundrule/spec@0.23.0
  - @groundrule/core@0.23.0

## 0.22.0

### Patch Changes

- Updated dependencies [2040dff]
  - @groundrule/spec@0.22.0
  - @groundrule/core@0.22.0

## 0.21.0

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
