# @groundrule/adapters

Turns standards into coding-agent instructions:

| Target | Writes | Ownership |
|--------|--------|-----------|
| `agents-md` | `AGENTS.md` | Managed block; your own content is preserved |
| `claude-code` | `CLAUDE.md` | Managed block; imports `@AGENTS.md` when both are targeted |
| `cursor` | `.cursor/rules/groundrule*.mdc` | Owned files; scoped standards use `globs` |
| `copilot` | `.github/copilot-instructions.md`, `.github/instructions/groundrule-*.instructions.md` | Managed block + owned files with `applyTo` |

Output is deterministic, so `groundrule sync --check` can run in CI.
