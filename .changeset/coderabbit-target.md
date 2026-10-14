---
"@groundrule/spec": minor
"@groundrule/adapters": minor
"@groundrule/cli": minor
---

CodeRabbit as a sync target (RFC 0010). With `coderabbit` in the config's `targets`, `groundrule sync` writes the rulebook into `.coderabbit.yaml`: review guidance per path scope, and CodeRabbit's custom pre-merge checks (advisory, at most five) for rules no deterministic check covers. Only Groundrule's own entries are managed; the team's settings, entries and comments stay as they are, and removing the target removes only Groundrule's entries. `groundrule init` picks the target up when a `.coderabbit.yaml` exists.
