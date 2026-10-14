# RFC 0010: CodeRabbit as a sync target

- **Status:** Accepted (15 October 2026)
- **Author:** Groundrule maintainers
- **Spec version:** v1alpha1

## Summary
Add `coderabbit` to the config's `targets`, so `groundrule sync` writes the rulebook into `.coderabbit.yaml`: review guidance per path scope, and CodeRabbit's custom pre-merge checks for the rules no deterministic check covers. The rulebook stays the one source; the reviewer becomes one more place it is delivered to, like `AGENTS.md`, Cursor rules and Copilot instructions.

## Motivation
Teams that use an AI reviewer keep its configuration by hand, per repository, and it drifts from the rules the agents read. Generating it from the rulebook keeps every tool on the same rules, and `sync --check` catches drift in CI. It also answers "why not CodeRabbit plus AGENTS.md?": CodeRabbit is one of the things Groundrule writes.

## Proposal
- `AGENT_TARGETS` gains `coderabbit`. The default stays `["agents-md"]`; older configs are unchanged.
- The adapter writes `.coderabbit.yaml`:
  - `reviews.path_instructions`: one entry per scope group (the grouping the Cursor and Copilot adapters use), `path` as a minimatch glob (`**` for everywhere, a brace group for several paths), `instructions` as the rules' text with their IDs, so review comments can cite them.
  - `reviews.pre_merge_checks.custom_checks`: for rules labelled AI review or guidance at blocker or warning severity, at most five (CodeRabbit's limit), highest severity first; `mode: warning` always, because AI never blocks a change on its own.
- **Only Groundrule's entries are managed.** Every generated instruction starts with `[groundrule]` and every generated check name with `Groundrule `; on each sync those entries are replaced, and the team's own entries, other keys and comments are left as they were. Removing the target from `targets` removes Groundrule's entries and nothing else. A missing file is created with the schema comment.
- The agent-sync report (RFC 0006) lists the target like any other, so the platform shows "CodeRabbit · up to date" per repository without a new field.

## Compatibility
Additive: one enum value. Receivers with the older schema reject configs and reports that name it; the platform updates before the CLI release.

## Alternatives considered
- **Owning the whole file.** Rejected: teams keep their own settings there (tone, auto-reviews, tools); a sync must not clobber them.
- **One path instruction per rule.** Rejected for now: CodeRabbit's limits on entry counts aren't published; grouping by scope keeps the file small and mirrors the other adapters.
- **`mode: error` for Enforce-stage rules.** Rejected: an AI verdict blocking a merge contradicts the label the rule carries; deterministic checks already block through the Groundrule check.
