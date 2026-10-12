---
"@groundrule/spec": minor
"@groundrule/cli": minor
---

`groundrule hooks` sets up GitHub Copilot too (the Copilot CLI and cloud agent): an `agentStop` hook in `.github/hooks/groundrule.json` runs the check when Copilot finishes and has it take another turn with what to fix. Agent reports (`sync --upload`) say whether it's installed. Spec: `copilot` added to the hook agents.
