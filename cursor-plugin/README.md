# Groundrule plugin for Cursor

Your engineering standards in Cursor: the rules for each file, a check of every change before the agent finishes, and a way to propose a rule when you correct the agent.

Install from the Cursor marketplace (search for Groundrule), or point Cursor at this repository.

The plugin bundles three things, all backed by the open-source CLI (`npx @groundrule/cli`, pinned to an exact version in `mcp.json` and `hooks/hooks.json`):

| Component | What it does |
|---|---|
| MCP server `groundrule` | `rules_for` (the rules for a file, blocking first), `check` (the same check CI runs, on the agent's uncommitted changes), `list_standards`, `propose_rule` ([docs](https://docs.groundrule.dev/developers/agents/mcp/)) |
| Stop hook | When the agent finishes, runs the check; if a blocker remains, what to fix is sent as a follow-up message, once per turn |
| Skill `groundrule` | When to call which tool, and what never to do with a standard |

Repository rules themselves come from `groundrule sync`, which writes `.cursor/rules/groundrule.mdc` from the same rulebook that produces `AGENTS.md`, `CLAUDE.md` and Copilot instructions, so every agent reads one source.

## Configuration

None. In a repository without `.groundrule/`, the hook and the tools do nothing. To set one up:

```bash
npx @groundrule/cli init    # detects the stack and picks packs
npx @groundrule/cli sync    # writes .cursor/rules/groundrule.mdc and the other agent files
```

Everything works offline and without an account. The CLI makes no network request unless the repository's config names a Groundrule workspace (`platform:`) and the developer has run `groundrule login`; then the hook and the `check` tool send that workspace counts per rule, never file paths, lines or code ([what is sent](https://docs.groundrule.dev/developers/agents/hooks/#what-the-workspace-learns)). No credentials are read from the environment.

## Releasing

Raise `version` in `.cursor-plugin/plugin.json` and the pinned CLI version in `mcp.json` and `hooks/hooks.json` together.
