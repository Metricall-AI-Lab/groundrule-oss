# RFC 0017: Action policies

- **Status:** Accepted (30 October 2026)
- **Author:** Groundrule maintainers
- **Spec version:** v1alpha1

## Summary
A second policy kind, `ActionPolicy`, says what a coding agent may *do*: which shell commands, file edits, reads, fetches and MCP tool calls it may run on its own, which need a person, and which are refused. A standard evaluates an artefact after the fact; an action policy evaluates an intended operation before it happens, in the agent's own before-tool hook, in milliseconds, with no network. Both kinds share one envelope (identity, scope, severity, owner, agent delivery, exceptions, references, compliance) so they are written, versioned, rolled out and excepted the same way. The local evaluator and the hook are part of the open-source kernel.

## Motivation
Groundrule already sits in the agent loop at two moments: before an edit (ADR 0010, rules for the file) and when the agent finishes (ADR 0007, the check). Neither can say "do not force-push", "ask before `terraform apply`", or "never read `.env`". Each agent vendor has a permission system for that, but it is per agent, per developer, in a vendor-specific file, with no owner, no expiry, no exception path and no evidence. A team that has written down what agents may do in Claude Code has to write it again for Cursor, Codex and Copilot, and nobody can show an auditor what the rule was on a given day.

Every agent now exposes a hook that runs before a tool call and takes a permission decision:

| Agent | Hook | Decisions | Input |
|---|---|---|---|
| Claude Code | `PreToolUse` | allow, ask, deny | `tool_name`, `tool_input` (`command`, `file_path`, `url`, MCP tools as `mcp__<server>__<tool>`) |
| Codex | `PreToolUse` | allow, deny (ask is not supported yet) | the same shape |
| Cursor | `beforeShellExecution`, `beforeMCPExecution`, `beforeReadFile` | allow, ask, deny (reads: allow, deny) | `command`; `mcp_server_name`, `tool_name`; `file_path` |
| Copilot (CLI and cloud) | `preToolUse` | allow, ask, deny (the cloud agent treats ask as deny) | `toolName`, `toolArgs` |

The same policy can therefore be enforced in all four, with an honest coverage map where a decision is not available.

## Proposal

### The kind
```yaml
apiVersion: groundrule.dev/v1alpha1
kind: ActionPolicy
metadata:
  id: ACT-001                        # same identifier space as standards, so exceptions work
  title: No force-pushes
  status: active                     # draft | active | deprecated | retired
  version: 1
  owner: team:platform
  category: git
spec:
  severity: blocker                  # how much a breach matters (evidence, agent files)
  scope: {}                          # repositories, tags; paths for file actions. Same as Standard.
  intent: A force-push rewrites shared history; a person decides when that is worth it.
  requirement: Never force-push. Ask the developer to do it, or open a new branch.
  effect: deny                       # allow | ask | deny. Default ask.
  when:                              # every listed field narrows the match; at least one is required
    actions: [shell]                 # shell | edit | read | fetch | mcp | other
    commands:                        # globs over each segment of a shell command
      - "git push --force*"
      - "git push -f*"
      - "git push * --force*"
      - "git push * -f*"
  agent:
    instruction: true                # also listed in AGENTS.md under "What you may not do alone"
    summary: Never force-push; ask the developer or use a new branch.
  exceptions:
    allowed: true
    approvers: [team:platform]
    maxDurationDays: 30
  references:
    - https://docs.acme.com/git
  compliance:
    - { framework: soc2, controls: [CC8.1] }
```

`when` fields:

| Field | Matched against | Actions |
|---|---|---|
| `actions` | the kind of operation | all |
| `commands` | each segment of a shell command (split on `&&`, `\|\|`, `;`, `\|`, newline), trimmed, so `git status && git push -f` is caught; a pattern that itself contains a pipe or a chain (`curl *\|*sh`) is matched against the whole command line instead; `*` matches anything including spaces and slashes, `?` one character; case-sensitive | `shell` |
| `paths` | the repository-relative POSIX path of the file (outside the repository: the absolute path), as a glob with `dot: true` | `edit`, `read` |
| `hosts` | the host of the URL, as a glob | `fetch` |
| `servers` | the MCP server name, as a glob | `mcp` |
| `tools` | the agent's tool name as the agent reports it (`Bash`, `Edit`, `mcp__github__create_issue`, `bash`, `apply_patch`…), as a glob; for MCP, also the tool's own name | all |

A policy matches when every listed field matches (within a field, any pattern). `scope` is matched the way it is for standards: `repositories` and `tags` against the repository, `paths`/`exclude` against the file of an edit or read (never against commands).

### The decision
`decideAction(policies, exceptions, action, target)` returns `allow`, `ask` or `deny` and the policies that matched. Precedence is `deny` > `ask` > `allow`; a matching `allow` only matters when nothing stricter matched, and lets the agent skip the vendor's own prompt. An active exception (`.groundrule/exceptions.yaml`, same `EX-` entries as for standards, `paths` applying to file actions) removes a policy from the decision and is named in the reason. The reason given to the agent names the policy, the requirement and what to do instead; it never contains the command or path beyond what the agent already sent.

Rollout stages apply when the policy comes from the platform: `observe` and `teach` take no decision (teach still reaches agent files); `advise` gives the agent the reason as context and takes no decision; `enforce` decides. A local policy has no stage and decides.

**Default `ask`, 50 ms budget, nothing on error.** A wrong deny stops a developer mid-task, and a hook that is slow gets turned off. So: the default effect is `ask`; evaluation is pure string matching with patterns compiled once; the hook has a five-second timeout at the agent and answers in well under 50 ms once Node has started; and any failure (no config, unreadable file, bad input) means no decision and the agent's own permission flow applies.

### The hook
`groundrule hooks` installs, next to the stop hook, a before-tool hook that runs `groundrule hook <agent> --before-tool`:

| Agent | Installed as | Decisions delivered |
|---|---|---|
| Claude Code | one `PreToolUse` entry for every tool (it replaces the `Edit\|Write\|MultiEdit` entry from ADR 0010; the rules for a file are still added to the same answer) | allow, ask, deny |
| Codex | `PreToolUse` for every tool | allow, deny; `ask` is delivered as deny with a reason that says a person must run it (fail closed, never silently open) |
| Cursor | `beforeShellExecution`, `beforeMCPExecution`, `beforeReadFile` | allow, ask, deny; reads: `ask` as deny |
| Copilot | `preToolUse` in Groundrule's own hook file | allow, ask, deny; the cloud agent treats ask as deny |

Output shapes: Claude Code and Codex `hookSpecificOutput.permissionDecision` with `permissionDecisionReason` (and `additionalContext` for the file rules); Cursor `permission` with `agent_message` and `user_message`; Copilot `permissionDecision` with `permissionDecisionReason`. When the workspace has no action policy the hook answers nothing, so an installation that only uses standards is unchanged apart from the hook's start-up time. Only Groundrule's own entries are added or removed; everything else in the file is kept.

### Coverage map
Documented, and printed by `groundrule doctor`:

| Action | Claude Code | Codex | Cursor | Copilot CLI | Copilot cloud |
|---|---|---|---|---|---|
| shell | enforced | enforced (ask → deny) | enforced | enforced | enforced (ask → deny) |
| edit | enforced | enforced where the tool is `apply_patch`, `Edit` or `Write` | unsupported (Cursor has no before-edit decision) | enforced | enforced (ask → deny) |
| read | enforced | advisory | enforced (ask → deny) | enforced | enforced (ask → deny) |
| fetch | enforced | advisory | advisory | enforced | enforced (ask → deny) |
| mcp | enforced | advisory | enforced | enforced | enforced (ask → deny) |

"Advisory" means the hook runs and the reason is written to the agent's hook log, but the agent reports the tool in a shape the hook cannot decide on; the row changes when the vendor does.

### Agent files and `check`
Policies with `agent.instruction: true` are rendered into `AGENTS.md`, Cursor rules and Copilot instructions in a section "What you may not do alone", one line each, so an agent without the hook still knows. `check` ignores action policies: they have no evaluator and never produce findings.

### The report (connected repositories)
After a decision of `ask` or `deny` in a repository connected to the platform, the CLI sends one `AgentAction` document, exactly as RFC 0012 sends `AgentCheck`: fire and forget, two-second timeout, failures ignored.

```yaml
apiVersion: groundrule.dev/v1alpha1
kind: AgentAction
metadata: { generatedAt: 2026-10-30T09:12:04Z, cliVersion: 0.24.0 }
repository: { name: acme/payments-api }
agent: { name: claude-code, via: hook, session: 3f1c… }   # session: sha256, as in RFC 0012
action: shell                                              # the kind only
decision: deny                                             # ask | deny
policies: [{ id: ACT-001, effect: deny }]                  # the policies that matched
```

It never contains the command, the path, the URL, the tool arguments or anything the agent or the developer wrote. `platform.reports: none` turns it off with the check reports.

### Packs
A bundled pack `groundrule:packs/agent-actions` ships ten policies: force-pushes, history rewrites, hook bypass, piping downloads into a shell, publishing packages and releases, applying infrastructure, elevated privileges, deleting outside the repository, reading or editing secret files, and editing CI workflows. A pack lists policies the way it lists standards (`include`); one file is one policy.

## Compatibility
Additive. A new document kind in the discriminated union; `Workspace` gains `actions`; a config's `standards` globs and a pack's `include` may now contain either kind, dispatched on `kind`; older CLIs refuse an `ActionPolicy` file with "Expected kind Standard" and should be upgraded. Exceptions reference policies by the same `standard:` field, since the identifier space is shared. `groundrule hooks` run again on an existing installation replaces the before-edit entry with the before-tool one; `hook claude-code --before-edit` keeps working for settings files that are not regenerated. The platform stores and serves `ActionPolicy` documents in the rulebook unchanged; a CLI that does not know the kind skips them with the existing "doesn't match this CLI's spec" warning.

## Alternatives considered
- **A `type: action` on `Standard`.** Rejected: the body is different (an effect and a match, not a requirement with checks), evaluation is different (an intent, not an artefact), and a reader must see at a glance which plane a document belongs to. The envelope is shared instead.
- **Compiling policies into each vendor's permission settings** (Claude Code `permissions.deny`, managed settings). Deferred to the fleet policy RFC: those settings have no `ask`-with-reason, no exceptions and no evidence, and they do not exist for every agent. The hook is the universal mechanism; compilation is an additional one for administrators.
- **Regular expressions for commands.** Rejected for v1: globs read like the commands they match, and a mistaken regex can be catastrophic in a deny rule. A `regex:` prefix can be added without breaking anything.
- **Deciding on the whole command string.** Rejected: `git status && git push --force` must be caught, and matching segments is what a reader expects.
- **Falling open when `ask` is unsupported.** Rejected: an author who chose `ask` wanted a person in the loop; silently running the action betrays that. Deny with a reason is honest, and the coverage map says where it happens.
- **Deciding with a model.** Rejected for this kind; semantic action rules belong to a later, clearly labelled mode (RFC 0013's honesty rules apply).

## Open questions
- Whether `allow` should be able to narrow a broader `ask` (an allow-list inside an ask-list). Not in v1: precedence is by effect only, and a narrower `ask` is written as a narrower pattern.
- Observed agent identity in the report (which model, which harness version) waits for the event model.
