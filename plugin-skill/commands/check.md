---
description: Run the Groundrule check on the uncommitted changes and fix what it finds.
argument-hint: "[--all | --base <ref>]"
---

Run `npx @groundrule/cli check $ARGUMENTS` in this repository. With no arguments it checks the uncommitted changes; `--all` audits every file; `--base origin/main` checks the branch.

For each blocking finding, read the rule (`npx @groundrule/cli explain <ID>` if the fix is not obvious), fix the code, and run the check again until it passes. Report warnings and leave them unless the fix is small. Never weaken a standard, add an exception or edit the generated agent files to make the check pass; if a rule is wrong for this code, say so.

If the repository has no `.groundrule` folder, say so and suggest `/groundrule:setup`.
