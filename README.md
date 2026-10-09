# Groundrule

**Define once. Enforce everywhere.**

Groundrule turns your engineering standards into executable rules for every developer, repository, and AI coding agent.

Write a standard once, as a small YAML file in git. Groundrule:

- **teaches your coding agents.** It generates `AGENTS.md`, `CLAUDE.md`, Cursor rules, and Copilot instructions containing only the standards that apply, without touching what you wrote by hand.
- **checks the code.** It runs locally and in CI against your changes or the whole repository, using deterministic checks, Semgrep, and (soon) AI review.
- **tells you why.** Every finding names the standard, shows the evidence, says how to fix it, and labels whether it came from a deterministic check or AI.

> **Status:** pre-alpha (0.1). The document format is `groundrule.dev/v1alpha1` and may change.

## Quick start

```bash
npx @groundrule/cli init      # detects your stack, picks packs, writes .groundrule/config.yaml
npx @groundrule/cli sync      # writes AGENTS.md / CLAUDE.md / Cursor / Copilot instructions
npx @groundrule/cli check     # checks your uncommitted changes
```

```text
 groundrule check · 11 standards · 2 files changed

 ✕ TS-003  No eval or new Function
   BLOCKER · deterministic (regex)
   src/app.ts:3
     eval or new Function in application code
     3: return eval(input);
   → Parse the input instead: JSON.parse, a schema, or a lookup table of allowed operations.
   → groundrule explain TS-003

 Failed  ✓ 7 passed  ✕ 1 failed  ◇ 2 guidance  · 0.1s
```

## A standard

```yaml
apiVersion: groundrule.dev/v1alpha1
kind: Standard
metadata:
  id: DEP-008
  title: Use the platform HTTP client
  type: forbidden-tech
  owner: team:platform
spec:
  severity: warning
  requirement: Backend services must use @acme/http-client for outbound HTTP calls.
  examples:
    forbidden: ["import axios from 'axios'"]
  checks:
    - evaluator: dependencies
      forbid: [axios, got, node-fetch]
      allowInstead: ["@acme/http-client"]
```

More in [`examples/foundation`](examples/foundation/.groundrule/standards).

## Commands

| Command | What it does |
|---------|--------------|
| `groundrule init` | Create `.groundrule/config.yaml` with packs for your stack |
| `groundrule sync [--check]` | Write (or verify) coding-agent instructions |
| `groundrule check [--base <ref>] [--all]` | Check changes, a branch, or everything. `-f json\|sarif\|markdown`, `--summary <file>` |
| `groundrule standards` | List the standards in effect |
| `groundrule explain <ID>` | Why a standard exists, examples, how to comply, exceptions |
| `groundrule doctor` | Check configuration, tools, and agent files |
| `groundrule packs` | List bundled packs |
| `groundrule scan [--json] [--upload]` | Observe this repository against the whole catalog: stack, agent files, tools, and how every rule would do today. Changes nothing |
| `groundrule propose "<rule>"` | Propose a rule for your team to review on the platform. `--why`, `--example`, `--file path[:line]` |
| `groundrule mcp` | Serve your standards to coding agents over MCP, and let them propose rules (see below) |
| `groundrule login` | Sign in to your organization on the Groundrule platform (browser approval) |
| `groundrule whoami` / `logout` | Show or remove (and revoke) your saved sign-in |

Exit codes: `0` passed, `1` failed, `2` configuration or usage error.

## Using the Groundrule platform (optional)

Everything above works offline. If your organization manages its standards on the Groundrule platform, connect a repository instead of listing packs:

```bash
npx @groundrule/cli login               # approve this computer in your browser
npx @groundrule/cli init --org acme     # writes platform: { org: acme } to .groundrule/config.yaml
npx @groundrule/cli sync                # your organization's rules, with every customization
```

`groundrule scan --upload` shares a scan with your organization so it can see which rules fit each repository. It also imports what you already have as proposals: instructions from AGENTS.md, CLAUDE.md, Cursor, and Copilot files; ESLint, Biome, Ruff, golangci-lint, Checkstyle, PMD, and tsconfig settings that match catalog rules; and CODEOWNERS (use `--no-import` to leave these out). Reports contain counts and at most three one-line, redacted snippets per rule (none for security rules, none at all with `--no-snippets`); `--json` shows exactly what would be sent. When uploading, the scan also tests your organization's own rules that have checks, drafts included, so you see their impact before publishing them.

What each command takes from the platform depends on the rule's rollout stage: `sync` writes rules at Teach, Advise, and Enforce into your agent files; `check` runs Enforce rules as set and Advise rules as warnings. Rules your repository defines in `.groundrule/standards/` still apply. In CI, set `GROUNDRULE_TOKEN` to a token from Settings → API tokens. Sign-ins are saved in `~/.config/groundrule/credentials.json`, readable only by you.

### Coding agents (MCP)

`groundrule mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server (stdio) with two tools:

- `list_standards`: the rules in effect in the repository, so the agent follows them. Works offline.
- `propose_rule`: when you correct your agent and say (or agree) that it should apply to everyone, it proposes the rule to your organization's review inbox, with where it came up. Nothing changes until a reviewer accepts it. Needs a connected repository and `groundrule login`.

Add it to your agent once per repository or user:

```bash
claude mcp add groundrule -- npx -y @groundrule/cli mcp          # Claude Code
```

```json
{ "mcpServers": { "groundrule": { "command": "npx", "args": ["-y", "@groundrule/cli", "mcp"] } } }
```

The JSON form goes in `.cursor/mcp.json` for Cursor, `.vscode/mcp.json` for VS Code (as `servers`), or your agent's MCP settings. Proposals carry the rule, your reason, and a file and line if given; nothing else from the repository is sent.

## Checks

| Evaluator | Source | Use it for |
|-----------|--------|-----------|
| `files` | deterministic | Required or forbidden files (CODEOWNERS, `.env`) |
| `regex` | deterministic | Forbidden or required patterns in code |
| `dependencies` | deterministic | Forbidden packages (npm, Maven, Gradle, pip, Go, Cargo) |
| `change-set` | deterministic | Rules about a change ("entity changes need a migration") |
| `semgrep` | static analysis | Semgrep rules you already have |
| `llm` | AI | Semantic review (coming in 0.2, bring your own key) |

## Packs

`groundrule packs` lists the bundled packs (security, TypeScript/Node, React, Python, Java/Spring, Go, Docker, Kubernetes, Terraform, GitHub Actions, HTTP APIs, testing, AI agent hygiene). Your organization's own packs work the same way: `github:your-org/engineering-standards//packs/backend@v1`.

## GitHub

See [`action/`](action/README.md): checks every pull request, writes a job summary, and uploads findings to code scanning.

## Development

```bash
pnpm install
pnpm check
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Groundrule checks itself: see [`.groundrule/`](.groundrule).

## License

[Apache-2.0](LICENSE). "Groundrule" is a trademark; see [GOVERNANCE.md](GOVERNANCE.md).
