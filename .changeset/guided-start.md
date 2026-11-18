---
"@groundrule/cli": minor
"@groundrule/reporters": minor
---

A guided start. `groundrule` alone, in a repository with no configuration, now takes a first look: it detects the stack, runs the checks over the whole repository and shows what they find today without writing anything, says how many rules are checked on every change and how many are instructions for coding agents only, then asks one question and sets the repository up (config, agent files, hooks). `groundrule start` is the same thing by name; `--yes` sets up without asking and `--no-hooks` leaves the hooks out. With nobody at the terminal it writes nothing and says how to finish.

`groundrule check` says more plainly what it left out: "N existing findings, not from this change (show with --verbose or --all)", and the summary reads "N guidance, not checked". `init` now points at `check --all` as the next step, so the first result is the repository as it stands.
