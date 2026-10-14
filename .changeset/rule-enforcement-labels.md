---
"@groundrule/core": minor
"@groundrule/cli": minor
---

Say how each rule is enforced, in one word: **checked** (a deterministic or static-analysis check can fail a change), **AI review** (AI checks only: advisory) or **agent guidance** (no check). `groundrule standards` leads each rule with it and flags a blocker or warning rule that can't fail a change; `groundrule explain` says so and suggests adding a check; the MCP `list_standards` tool marks rules that are checked automatically at their current stage. New in `@groundrule/core`: `enforcementOf()`, `cannotFail()`.
