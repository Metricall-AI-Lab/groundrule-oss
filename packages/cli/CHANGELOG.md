# @groundrule/cli

## 0.1.0

### Minor Changes

- 2ee2e56: Connect repositories to the Groundrule platform: `groundrule login` (browser approval), `whoami`, `logout`, and `init --org`. With `platform:` in the config, `sync` writes your organization's rules at Teach and above, and `check` runs Enforce rules as set and Advise rules as warnings. `GROUNDRULE_TOKEN` works in CI.
- 8b17412: Add `groundrule propose "<rule>"` to propose a rule for your team to review on the Groundrule platform, and `groundrule mcp`, a Model Context Protocol server (stdio) that lets coding agents list the standards in effect and propose rules when a developer corrects them. New package `@groundrule/mcp`: a dependency-free, tools-only MCP server.
- ddf5aef: Add `groundrule scan`: observe a repository against the whole catalog without changing anything. Reports the stack, existing agent instruction files, tool configurations, and how every applicable rule would do today. `--json` prints the report (new `ScanReport` spec kind), `--upload` shares it with your organization, `--no-snippets` leaves code out.
- b4757b4: `groundrule scan` imports what a repository already has as proposals: instructions from agent files (split by heading and list item, de-duplicated, matched to similar catalog rules), linter and compiler settings that enforce catalog rules, and CODEOWNERS entries. `--no-import` leaves them out.
- 9ed48cd: `groundrule scan --upload` also tests your organization's own rules that have checks, including drafts, against the repository, so their impact shows on the platform before anyone publishes them. An organization rule replaces a catalog rule with the same ID in the scan. Platforms without this feature, or any error fetching the rules, leave the scan to the catalog.

### Patch Changes

- 2d4452e: `groundrule whoami` now finds logins made with `login --url` from any folder, and an empty `GROUNDRULE_URL` counts as unset. The MCP `list_standards` tool shows each organization rule's rollout stage, so agents know which findings only warn.
- Updated dependencies [2d4452e]
- Updated dependencies [2ee2e56]
- Updated dependencies [8b17412]
- Updated dependencies [ddf5aef]
- Updated dependencies [b4757b4]
  - @groundrule/adapters@0.1.0
  - @groundrule/spec@0.1.0
  - @groundrule/core@0.1.0
  - @groundrule/mcp@0.1.0
  - @groundrule/packs@0.1.0
  - @groundrule/evaluators@0.1.0
  - @groundrule/reporters@0.1.0
