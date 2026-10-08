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

Exit codes: `0` passed, `1` failed, `2` configuration or usage error.

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

`groundrule:packs/security-baseline`, `groundrule:packs/typescript-node`, `groundrule:packs/java-spring`. Your organization's own packs work the same way: `github:your-org/engineering-standards//packs/backend@v1`.

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
