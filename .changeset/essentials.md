---
"@groundrule/cli": minor
"@groundrule/core": minor
"@groundrule/packs": minor
"@groundrule/reporters": patch
---

A new repository now starts from the **essentials** (`groundrule:packs/essentials`): about a dozen rules per repository, drawn from the full packs, every one with a deterministic check. `groundrule` and `groundrule init` use it by default; `init --packs` still chooses others, and extending a full pack next to it is not a duplicate. The agent file for a TypeScript repository drops from 167 lines to 66.

Three security rules that were instructions only now have checks: SEC-015 (SQL built by interpolation, concatenation or formatting, in JavaScript, TypeScript, Python, Go, Kotlin, C#, PHP and Ruby), SEC-016 (pickle, ObjectInputStream, BinaryFormatter, unserialize, Marshal) and SEC-019 (JWT verification turned off, the none algorithm, unverified parsing). Each has fixtures for what it must flag and what it must leave alone.

The first look counts only the rules that apply to the repository, and advisory findings are drawn lighter than warnings.
