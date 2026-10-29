# Groundrule plugin for Claude Code

Your engineering standards in Claude Code: the rules for each file before it is edited, a check of every change before the agent finishes, and a way to propose a rule when you correct the agent.

```bash
claude plugin install groundrule        # from Anthropic's directory, once listed
# or, from this repository:
claude plugin install --plugin-dir ./plugin
```

The plugin bundles three things, all backed by the open-source CLI (`npx @groundrule/cli`):

| Component | What it does |
|---|---|
| MCP server `groundrule` | `rules_for`, `check`, `list_standards`, `propose_rule` ([docs](https://docs.groundrule.dev/developers/agents/mcp/)) |
| Hooks | Before an edit: the rules for that file, once per file per session. On stop: the check, and the agent is sent back if a blocker remains |
| Skill `groundrule` | When to call which tool, and what never to do with a standard |

In a repository without `.groundrule/`, nothing runs. `npx @groundrule/cli init` sets one up; it works offline and without an account. Nothing leaves your machine unless the repository is connected to a workspace, in which case the hook reports counts per rule, never code ([what is sent](https://docs.groundrule.dev/developers/agents/hooks/#what-the-workspace-learns)).

What the plugin runs and sends: every component runs `npx @groundrule/cli` at the exact version pinned in `.mcp.json` and `hooks/hooks.json` (npm downloads it on first use). The CLI reads the repository's `.groundrule/` folder and the files being changed; it makes no network request unless the repository's config names a Groundrule workspace (`platform:`) and the developer has run `groundrule login`, in which case it sends counts per rule, never code. No credentials are read from the environment.

Releasing: raise `version` in `.claude-plugin/plugin.json` and the pinned CLI version in `.mcp.json` and `hooks/hooks.json` together. Validate after a change: `claude plugin validate ./plugin --strict`.
