---
"@groundrule/spec": minor
"@groundrule/core": minor
"@groundrule/packs": minor
"@groundrule/cli": minor
---

`groundrule scan` imports what a repository already has as proposals: instructions from agent files (split by heading and list item, de-duplicated, matched to similar catalog rules), linter and compiler settings that enforce catalog rules, and CODEOWNERS entries. `--no-import` leaves them out.
