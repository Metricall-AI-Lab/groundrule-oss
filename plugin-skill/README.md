# Groundrule skill for Claude Code

The bundle listed in Anthropic's plugin directory: a skill and two commands, backed by the open-source CLI (`npx @groundrule/cli`). No hooks, no MCP server, nothing that runs by itself.

| Component | What it does |
|---|---|
| Skill `groundrule` | Follow the rules in the agent file, respect the team's action policies, run the check before finishing, and never weaken a standard to pass |
| `/groundrule:setup` | Pick packs for the stack, write `AGENTS.md` and `CLAUDE.md`, run the first check, and offer to add the hooks |
| `/groundrule:check` | Run the check on the uncommitted changes and fix what it finds |

## Why it is smaller than the full plugin

The directory accepts hooks and local MCP servers only from organizations Anthropic has verified, and there is no way to request that yet. The full plugin in [`plugin/`](../plugin) has both: a hook that decides each tool call against your action policies, a hook that runs the check when the agent finishes, and an MCP server. Install it from this repository's marketplace instead, inside Claude Code:

```
/plugin marketplace add Metricall-AI-Lab/groundrule-oss
/plugin install groundrule@groundrule
```

Install one or the other, not both. With this bundle, `npx @groundrule/cli hooks` adds the same two hooks to the repository's own `.claude/settings.json`, which also gives them to every developer on the team.

## What it runs and sends

The skill and the commands tell Claude to run `npx @groundrule/cli` in your terminal, with your usual permission prompts. The CLI reads the repository's `.groundrule/` folder and the files being changed. It makes no network request unless the repository's config names a Groundrule workspace (`platform:`) and the developer has run `groundrule login`.

Validate after a change: `claude plugin validate ./plugin-skill --strict`.
