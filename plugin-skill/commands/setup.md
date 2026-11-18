---
description: Set this repository up with Groundrule: pick packs for the stack, write the agent files, run the first check.
---

Set this repository up with Groundrule, using the open-source CLI. Say what each step did in one line, and stop if a step fails.

1. If `.groundrule/config.yaml` already exists, say so and skip to step 3.
2. Run `npx @groundrule/cli init`. It detects the stack and writes `.groundrule/config.yaml` with the packs that fit. Show the user which packs it chose.
3. Run `npx @groundrule/cli sync`. It writes the rules into `AGENTS.md` and `CLAUDE.md`, leaving anything the user wrote by hand alone.
4. Run `npx @groundrule/cli check --all`. Summarize what it found: how many rules passed, and each blocking finding with its rule, file and line. Do not fix anything yet; ask the user what they want to do about the findings.
5. Ask whether to make it automatic, and only if the user agrees run `npx @groundrule/cli hooks`, which adds a hook that decides commands and tool calls against the team's action policies and a hook that runs the check when you finish.
6. Tell the user which files to commit: `.groundrule/`, `AGENTS.md`, `CLAUDE.md`, and `.claude/settings.json` if the hooks were added.
